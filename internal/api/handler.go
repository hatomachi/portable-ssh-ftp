package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"time"

	"portable-ssh-ftp/internal/config"
	"portable-ssh-ftp/internal/lifecycle"
	"portable-ssh-ftp/internal/logger"
	"portable-ssh-ftp/internal/session"
)

type API struct {
	mgr          *session.Manager
	profileStore *config.ProfileStore
	lifecycleMgr *lifecycle.Manager
}

func NewAPI(mgr *session.Manager, profileStore *config.ProfileStore) *API {
	if profileStore == nil {
		profileStore = config.NewProfileStore("")
	}
	return &API{mgr: mgr, profileStore: profileStore}
}

func (a *API) SetLifecycleManager(lm *lifecycle.Manager) {
	a.lifecycleMgr = lm
}

func (a *API) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/connect", a.handleConnect)
	mux.HandleFunc("/api/disconnect", a.handleDisconnect)
	mux.HandleFunc("/api/status", a.handleStatus)

	mux.HandleFunc("/api/ftp/list", a.handleFTPList)
	mux.HandleFunc("/api/ftp/pwd", a.handleFTPPwd)
	mux.HandleFunc("/api/ftp/cd", a.handleFTPCd)
	mux.HandleFunc("/api/ftp/download", a.handleFTPDownload)
	mux.HandleFunc("/api/ftp/upload", a.handleFTPUpload)
	mux.HandleFunc("/api/ftp/delete", a.handleFTPDelete)
	mux.HandleFunc("/api/ftp/mkdir", a.handleFTPMkdir)

	mux.HandleFunc("/api/ssh/files", a.handleSSHFiles)
	mux.HandleFunc("/api/ssh/file/view", a.handleSSHFileView)
	mux.HandleFunc("/api/ssh/upload", a.handleSSHUpload)
	mux.HandleFunc("/api/ssh/download", a.handleSSHDownload)
	mux.HandleFunc("GET /api/session/{id}/ssh/files", a.handleSessionSSHFiles)
	mux.HandleFunc("GET /api/session/{id}/ssh/file/view", a.handleSessionSSHFileView)
	mux.HandleFunc("POST /api/session/{id}/ssh/upload", a.handleSessionSSHUpload)
	mux.HandleFunc("GET /api/session/{id}/ssh/download", a.handleSessionSSHDownload)
	mux.HandleFunc("POST /api/session/{id}/duplicate", a.handleDuplicateSession)
	mux.HandleFunc("POST /api/session/duplicate", a.handleDuplicateSession)
	mux.HandleFunc("POST /api/session/{id}/reconnect", a.handleReconnectSession)
	mux.HandleFunc("POST /api/session/reconnect", a.handleReconnectSession)
	mux.HandleFunc("GET /api/sessions", a.handleSessions)

	mux.HandleFunc("GET /api/logs", a.handleListLogs)
	mux.HandleFunc("GET /api/logs/download", a.handleDownloadLog)

	mux.HandleFunc("GET /api/profiles", a.handleListProfiles)
	mux.HandleFunc("POST /api/profiles", a.handleSaveProfile)
	mux.HandleFunc("DELETE /api/profiles", a.handleDeleteProfile)
	mux.HandleFunc("DELETE /api/profiles/{id}", a.handleDeleteProfile)

	// Lifecycle & Auto-Shutdown
	mux.HandleFunc("/api/heartbeat", a.handleHeartbeat)
	mux.HandleFunc("/api/shutdown-beacon", a.handleShutdownBeacon)
	mux.HandleFunc("/api/shutdown", a.handleShutdown)
}

func jsonResponse(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func errorResponse(w http.ResponseWriter, status int, message string) {
	jsonResponse(w, status, map[string]string{"error": message})
}

func (a *API) handleConnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errorResponse(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var req session.ConnectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errorResponse(w, http.StatusBadRequest, "Invalid request payload: "+err.Error())
		return
	}

	sess, err := a.mgr.CreateSession(req)
	if err != nil {
		errorResponse(w, http.StatusInternalServerError, "Connection failed: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"sessionId":    sess.ID,
		"sshConnected": sess.SSHClient != nil,
		"ftpConnected": sess.FTPClient != nil,
		"host":         req.Host,
		"logFilePath":  sess.LogFilePath,
	})
}

func (a *API) handleDisconnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errorResponse(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	sessionID := r.URL.Query().Get("sessionId")
	if err := a.mgr.CloseSession(sessionID); err != nil {
		errorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{"status": "disconnected"})
}

func (a *API) handleStatus(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sessionId")
	sess, ok := a.mgr.GetSession(sessionID)
	if !ok {
		jsonResponse(w, http.StatusOK, map[string]any{
			"connected": false,
		})
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"connected":    true,
		"sessionId":    sess.ID,
		"sshConnected": sess.SSHClient != nil,
		"ftpConnected": sess.FTPClient != nil,
		"host":         sess.SSHConfig.Host,
		"sshPort":      sess.SSHConfig.Port,
		"sshUsername":  sess.SSHConfig.Username,
		"ftpPort":      sess.FTPConfig.Port,
		"ftpUsername":  sess.FTPConfig.Username,
		"ftpCharset":   sess.FTPConfig.Charset,
		"logFilePath":  sess.LogFilePath,
	})
}

func (a *API) getFTPClient(r *http.Request) (*session.Session, error) {
	sessionID := r.URL.Query().Get("sessionId")
	sess, ok := a.mgr.GetSession(sessionID)
	if !ok || sess.FTPClient == nil {
		return nil, fmt.Errorf("FTP not connected")
	}
	return sess, nil
}

func (a *API) handleFTPList(w http.ResponseWriter, r *http.Request) {
	sess, err := a.getFTPClient(r)
	if err != nil {
		errorResponse(w, http.StatusBadRequest, err.Error())
		return
	}

	remotePath := r.URL.Query().Get("path")
	if remotePath == "" {
		remotePath = "."
	}

	entries, err := sess.FTPClient.List(remotePath)
	if err != nil {
		errorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"path":    remotePath,
		"entries": entries,
	})
}

func (a *API) handleFTPPwd(w http.ResponseWriter, r *http.Request) {
	sess, err := a.getFTPClient(r)
	if err != nil {
		errorResponse(w, http.StatusBadRequest, err.Error())
		return
	}

	pwd, err := sess.FTPClient.CurrentDir()
	if err != nil {
		errorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{
		"pwd": pwd,
	})
}

func (a *API) handleFTPCd(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errorResponse(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	sess, err := a.getFTPClient(r)
	if err != nil {
		errorResponse(w, http.StatusBadRequest, err.Error())
		return
	}

	var payload struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		errorResponse(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := sess.FTPClient.ChangeDir(payload.Path); err != nil {
		errorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}

	pwd, _ := sess.FTPClient.CurrentDir()
	jsonResponse(w, http.StatusOK, map[string]string{
		"pwd": pwd,
	})
}

func (a *API) handleFTPDownload(w http.ResponseWriter, r *http.Request) {
	sess, err := a.getFTPClient(r)
	if err != nil {
		errorResponse(w, http.StatusBadRequest, err.Error())
		return
	}

	remotePath := r.URL.Query().Get("path")
	if remotePath == "" {
		errorResponse(w, http.StatusBadRequest, "path parameter is required")
		return
	}

	reader, err := sess.FTPClient.Download(remotePath)
	if err != nil {
		errorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer reader.Close()

	filename := path.Base(remotePath)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename*=UTF-8''%s", url.PathEscape(filename)))
	w.Header().Set("Content-Type", "application/octet-stream")

	_, _ = io.Copy(w, reader)
}

func (a *API) handleFTPUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errorResponse(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	sess, err := a.getFTPClient(r)
	if err != nil {
		errorResponse(w, http.StatusBadRequest, err.Error())
		return
	}

	// 32MB max in memory
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		errorResponse(w, http.StatusBadRequest, "Failed to parse multipart form: "+err.Error())
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		errorResponse(w, http.StatusBadRequest, "No file provided: "+err.Error())
		return
	}
	defer file.Close()

	targetDir := r.FormValue("dir")
	if targetDir == "" {
		targetDir = "."
	}

	remotePath := path.Join(targetDir, header.Filename)
	if err := sess.FTPClient.Upload(remotePath, file); err != nil {
		errorResponse(w, http.StatusInternalServerError, "Upload failed: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{
		"status": "uploaded",
		"path":   remotePath,
	})
}

func (a *API) handleFTPDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete && r.Method != http.MethodPost {
		errorResponse(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	sess, err := a.getFTPClient(r)
	if err != nil {
		errorResponse(w, http.StatusBadRequest, err.Error())
		return
	}

	remotePath := r.URL.Query().Get("path")
	if remotePath == "" {
		errorResponse(w, http.StatusBadRequest, "path parameter is required")
		return
	}

	isDir, _ := strconv.ParseBool(r.URL.Query().Get("isDir"))

	if err := sess.FTPClient.Delete(remotePath, isDir); err != nil {
		errorResponse(w, http.StatusInternalServerError, "Delete failed: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{
		"status": "deleted",
		"path":   remotePath,
	})
}

func (a *API) handleFTPMkdir(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errorResponse(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	sess, err := a.getFTPClient(r)
	if err != nil {
		errorResponse(w, http.StatusBadRequest, err.Error())
		return
	}

	var payload struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		errorResponse(w, http.StatusBadRequest, err.Error())
		return
	}

	if payload.Path == "" {
		errorResponse(w, http.StatusBadRequest, "path is required")
		return
	}

	if err := sess.FTPClient.MakeDir(payload.Path); err != nil {
		errorResponse(w, http.StatusInternalServerError, "MakeDir failed: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{
		"status": "created",
		"path":   payload.Path,
	})
}

func (a *API) getSSHClient(sessionID string) (*session.Session, error) {
	sess, ok := a.mgr.GetSession(sessionID)
	if !ok || sess.SSHClient == nil {
		return nil, fmt.Errorf("SSH not connected")
	}
	return sess, nil
}

func (a *API) handleSSHFiles(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sessionId")
	sess, err := a.getSSHClient(sessionID)
	if err != nil {
		errorResponse(w, http.StatusBadRequest, err.Error())
		return
	}

	remotePath := r.URL.Query().Get("path")
	resolvedPath, entries, err := sess.SSHClient.ListFiles(remotePath)
	if err != nil {
		errorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"path":    resolvedPath,
		"entries": entries,
	})
}

func (a *API) handleSSHFileView(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sessionId")
	sess, err := a.getSSHClient(sessionID)
	if err != nil {
		errorResponse(w, http.StatusBadRequest, err.Error())
		return
	}

	remotePath := r.URL.Query().Get("path")
	if remotePath == "" {
		errorResponse(w, http.StatusBadRequest, "path parameter is required")
		return
	}

	var maxBytes int64 = 65536
	if mbStr := r.URL.Query().Get("maxBytes"); mbStr != "" {
		if mb, err := strconv.ParseInt(mbStr, 10, 64); err == nil && mb > 0 {
			maxBytes = mb
		}
	}

	content, totalSize, truncated, err := sess.SSHClient.ReadFileHead(remotePath, maxBytes)
	if err != nil {
		errorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"path":      remotePath,
		"name":      path.Base(remotePath),
		"size":      totalSize,
		"content":   content,
		"truncated": truncated,
	})
}

func (a *API) handleSessionSSHFiles(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	q.Set("sessionId", r.PathValue("id"))
	r.URL.RawQuery = q.Encode()
	a.handleSSHFiles(w, r)
}

func (a *API) handleSessionSSHFileView(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	q.Set("sessionId", r.PathValue("id"))
	r.URL.RawQuery = q.Encode()
	a.handleSSHFileView(w, r)
}

func (a *API) handleSSHUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errorResponse(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	sessionID := r.URL.Query().Get("sessionId")
	if sessionID == "" {
		sessionID = r.FormValue("sessionId")
	}
	sess, err := a.getSSHClient(sessionID)
	if err != nil {
		errorResponse(w, http.StatusBadRequest, err.Error())
		return
	}

	// 64MB max in memory before temporary file
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		errorResponse(w, http.StatusBadRequest, "Failed to parse multipart form: "+err.Error())
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		errorResponse(w, http.StatusBadRequest, "No file provided: "+err.Error())
		return
	}
	defer file.Close()

	targetDir := r.FormValue("dir")
	if targetDir == "" {
		targetDir = "."
	}

	uploadedPath, err := sess.SSHClient.UploadFile(targetDir, header.Filename, file, header.Size, 0644)
	if err != nil {
		errorResponse(w, http.StatusInternalServerError, "Upload failed: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{
		"status": "uploaded",
		"path":   uploadedPath,
		"name":   header.Filename,
	})
}

func (a *API) handleSessionSSHUpload(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	q.Set("sessionId", r.PathValue("id"))
	r.URL.RawQuery = q.Encode()
	a.handleSSHUpload(w, r)
}

func (a *API) handleSSHDownload(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sessionId")
	sess, err := a.getSSHClient(sessionID)
	if err != nil {
		errorResponse(w, http.StatusBadRequest, err.Error())
		return
	}

	remotePath := r.URL.Query().Get("path")
	if remotePath == "" {
		errorResponse(w, http.StatusBadRequest, "path parameter is required")
		return
	}

	filename, size, _ := sess.SSHClient.StatFile(remotePath)
	if filename == "" || filename == "." || filename == "/" {
		filename = path.Base(remotePath)
	}

	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename*=UTF-8''%s", url.PathEscape(filename)))
	w.Header().Set("Content-Type", "application/octet-stream")
	if size > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	}

	if err := sess.SSHClient.DownloadFile(remotePath, w); err != nil {
		return
	}
}

func (a *API) handleSessionSSHDownload(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	q.Set("sessionId", r.PathValue("id"))
	r.URL.RawQuery = q.Encode()
	a.handleSSHDownload(w, r)
}

func (a *API) handleDuplicateSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errorResponse(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	sessionID := r.PathValue("id")
	if sessionID == "" {
		sessionID = r.URL.Query().Get("sessionId")
	}
	if sessionID == "" {
		// Attempt to read from JSON body if present
		var body struct {
			SessionID string `json:"sessionId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err == nil && body.SessionID != "" {
			sessionID = body.SessionID
		}
	}

	sess, err := a.mgr.DuplicateSession(sessionID)
	if err != nil {
		errorResponse(w, http.StatusInternalServerError, "Failed to duplicate session: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"sessionId":    sess.ID,
		"sshConnected": sess.SSHClient != nil,
		"ftpConnected": sess.FTPClient != nil,
		"host":         sess.Req.Host,
		"sshPort":      sess.SSHConfig.Port,
		"sshUsername":  sess.SSHConfig.Username,
		"ftpPort":      sess.FTPConfig.Port,
		"ftpUsername":  sess.FTPConfig.Username,
		"ftpCharset":   sess.FTPConfig.Charset,
		"logFilePath":  sess.LogFilePath,
	})
}

func (a *API) handleReconnectSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errorResponse(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	sessionID := r.PathValue("id")
	if sessionID == "" {
		sessionID = r.URL.Query().Get("sessionId")
	}
	if sessionID == "" {
		var body struct {
			SessionID string `json:"sessionId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err == nil && body.SessionID != "" {
			sessionID = body.SessionID
		}
	}

	sess, err := a.mgr.ReconnectSession(sessionID)
	if err != nil {
		errorResponse(w, http.StatusInternalServerError, "Failed to reconnect session: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"sessionId":    sess.ID,
		"sshConnected": sess.SSHClient != nil,
		"ftpConnected": sess.FTPClient != nil,
		"host":         sess.Req.Host,
		"sshPort":      sess.SSHConfig.Port,
		"sshUsername":  sess.SSHConfig.Username,
		"ftpPort":      sess.FTPConfig.Port,
		"ftpUsername":  sess.FTPConfig.Username,
		"ftpCharset":   sess.FTPConfig.Charset,
		"logFilePath":  sess.LogFilePath,
	})
}

func (a *API) handleSessions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		errorResponse(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	summaries := a.mgr.ListSessions()
	jsonResponse(w, http.StatusOK, map[string]any{
		"sessions": summaries,
	})
}

func (a *API) handleListLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		errorResponse(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	logs, err := logger.ListLogs()
	if err != nil {
		errorResponse(w, http.StatusInternalServerError, "Failed to list logs: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"logs": logs,
	})
}

func (a *API) handleDownloadLog(w http.ResponseWriter, r *http.Request) {
	fileName := r.URL.Query().Get("file")
	if fileName == "" {
		errorResponse(w, http.StatusBadRequest, "file parameter is required")
		return
	}

	// Prevent path traversal
	safeName := filepath.Base(fileName)
	targetPath := filepath.Join("logs", safeName)

	file, err := os.Open(targetPath)
	if err != nil {
		if os.IsNotExist(err) {
			errorResponse(w, http.StatusNotFound, "Log file not found")
			return
		}
		errorResponse(w, http.StatusInternalServerError, "Failed to open log file: "+err.Error())
		return
	}
	defer file.Close()

	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename*=UTF-8''%s", url.PathEscape(safeName)))
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")

	_, _ = io.Copy(w, file)
}

func (a *API) handleListProfiles(w http.ResponseWriter, r *http.Request) {
	profiles, err := a.profileStore.List()
	if err != nil {
		errorResponse(w, http.StatusInternalServerError, "Failed to list profiles: "+err.Error())
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{
		"profiles": profiles,
	})
}

func (a *API) handleSaveProfile(w http.ResponseWriter, r *http.Request) {
	var p config.Profile
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		errorResponse(w, http.StatusBadRequest, "Invalid profile payload: "+err.Error())
		return
	}

	if p.Name == "" {
		p.Name = p.Host
	}

	saved, err := a.profileStore.Save(p)
	if err != nil {
		errorResponse(w, http.StatusInternalServerError, "Failed to save profile: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"profile": saved,
	})
}

func (a *API) handleDeleteProfile(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		id = r.URL.Query().Get("id")
	}
	if id == "" {
		errorResponse(w, http.StatusBadRequest, "Profile ID is required")
		return
	}

	if err := a.profileStore.Delete(id); err != nil {
		errorResponse(w, http.StatusInternalServerError, "Failed to delete profile: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (a *API) handleHeartbeat(w http.ResponseWriter, r *http.Request) {
	if a.lifecycleMgr != nil {
		a.lifecycleMgr.RecordHeartbeat()
	}
	jsonResponse(w, http.StatusOK, map[string]any{"status": "ok"})
}

func (a *API) handleShutdownBeacon(w http.ResponseWriter, r *http.Request) {
	if a.lifecycleMgr != nil {
		a.lifecycleMgr.FastShutdownNotice()
	}
	jsonResponse(w, http.StatusOK, map[string]any{"status": "ok"})
}

func (a *API) handleShutdown(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errorResponse(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if a.lifecycleMgr != nil {
		go func() {
			time.Sleep(100 * time.Millisecond)
			a.lifecycleMgr.TriggerShutdown()
		}()
	}
	jsonResponse(w, http.StatusOK, map[string]any{"status": "shutting_down"})
}


