package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"portable-ssh-ftp/internal/ai"
	"portable-ssh-ftp/internal/config"
	"portable-ssh-ftp/internal/lifecycle"
	"portable-ssh-ftp/internal/session"
)

func TestAPI_DuplicateSession_NotFound(t *testing.T) {
	mgr := session.NewManager()
	api := NewAPI(mgr, nil)

	mux := http.NewServeMux()
	api.RegisterRoutes(mux)

	// Test POST /api/session/{id}/duplicate with unknown id
	req := httptest.NewRequest(http.MethodPost, "/api/session/unknown-id/duplicate", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 status, got %d", w.Code)
	}

	var resp map[string]string
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !strings.Contains(resp["error"], "session not found") {
		t.Errorf("expected 'session not found' error message, got: %s", resp["error"])
	}
}

func TestAPI_ListSessions_Empty(t *testing.T) {
	mgr := session.NewManager()
	api := NewAPI(mgr, nil)

	mux := http.NewServeMux()
	api.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/sessions", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 status, got %d", w.Code)
	}

	var resp struct {
		Sessions []session.SessionSummary `json:"sessions"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(resp.Sessions) != 0 {
		t.Errorf("expected 0 sessions, got %d", len(resp.Sessions))
	}
}

func TestAPI_Profiles(t *testing.T) {
	tmpDir := t.TempDir()
	store := config.NewProfileStore(filepath.Join(tmpDir, "profiles.json"))
	mgr := session.NewManager()
	api := NewAPI(mgr, store)

	mux := http.NewServeMux()
	api.RegisterRoutes(mux)

	// 1. Initial list should be empty
	req := httptest.NewRequest(http.MethodGet, "/api/profiles", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var listResp struct {
		Profiles []config.Profile `json:"profiles"`
	}
	if err := json.NewDecoder(w.Body).Decode(&listResp); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if len(listResp.Profiles) != 0 {
		t.Fatalf("expected 0 profiles, got %d", len(listResp.Profiles))
	}

	// 2. Save a profile
	saveBody := config.Profile{
		Name:         "Production Web 01",
		Host:         "192.168.1.10",
		SSHPort:      22,
		SSHUsername:  "admin",
		FTPPort:      21,
		FTPUsername:  "ftpadmin",
		FTPCharset:   "Shift-JIS",
		EnableSSH:    true,
		EnableFTP:    true,
		SavePassword: false,
		SSHPassword:  "secret-to-be-cleared",
	}
	bodyBytes, _ := json.Marshal(saveBody)
	req = httptest.NewRequest(http.MethodPost, "/api/profiles", bytes.NewReader(bodyBytes))
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var saveResp struct {
		Profile config.Profile `json:"profile"`
	}
	if err := json.NewDecoder(w.Body).Decode(&saveResp); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if saveResp.Profile.ID == "" {
		t.Fatal("expected generated profile ID")
	}
	if saveResp.Profile.Name != "Production Web 01" {
		t.Errorf("expected name 'Production Web 01', got %s", saveResp.Profile.Name)
	}
	if saveResp.Profile.SSHPassword != "" {
		t.Errorf("expected password to be cleared when SavePassword is false, got %s", saveResp.Profile.SSHPassword)
	}

	profileID := saveResp.Profile.ID

	// 3. List should have 1 profile
	req = httptest.NewRequest(http.MethodGet, "/api/profiles", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	listResp = struct {
		Profiles []config.Profile `json:"profiles"`
	}{}
	_ = json.NewDecoder(w.Body).Decode(&listResp)
	if len(listResp.Profiles) != 1 {
		t.Fatalf("expected 1 profile, got %d", len(listResp.Profiles))
	}

	// 4. Delete profile
	req = httptest.NewRequest(http.MethodDelete, "/api/profiles/"+profileID, nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 on delete, got %d", w.Code)
	}

	// 5. List should be empty again
	req = httptest.NewRequest(http.MethodGet, "/api/profiles", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	listResp = struct {
		Profiles []config.Profile `json:"profiles"`
	}{}
	_ = json.NewDecoder(w.Body).Decode(&listResp)
	if len(listResp.Profiles) != 0 {
		t.Fatalf("expected 0 profiles after delete, got %d", len(listResp.Profiles))
	}
}

func TestAPI_SSHUpload_Validation(t *testing.T) {
	mgr := session.NewManager()
	api := NewAPI(mgr, nil)

	mux := http.NewServeMux()
	api.RegisterRoutes(mux)

	// POST /api/ssh/upload with no session -> 400
	req := httptest.NewRequest(http.MethodPost, "/api/ssh/upload", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 status for missing session, got %d", w.Code)
	}
}

func TestAPI_SSHDownload_Validation(t *testing.T) {
	mgr := session.NewManager()
	api := NewAPI(mgr, nil)

	mux := http.NewServeMux()
	api.RegisterRoutes(mux)

	// GET /api/ssh/download with no session -> 400
	req := httptest.NewRequest(http.MethodGet, "/api/ssh/download?path=/test.txt", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 status for missing session, got %d", w.Code)
	}
}

func TestAPI_Lifecycle(t *testing.T) {
	mgr := session.NewManager()
	api := NewAPI(mgr, nil)
	lifeMgr := lifecycle.NewManager(true, 5*time.Second)
	api.SetLifecycleManager(lifeMgr)

	mux := http.NewServeMux()
	api.RegisterRoutes(mux)

	// POST /api/heartbeat -> 200
	req := httptest.NewRequest(http.MethodPost, "/api/heartbeat", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for heartbeat, got %d", w.Code)
	}

	// POST /api/shutdown-beacon -> 200
	req = httptest.NewRequest(http.MethodPost, "/api/shutdown-beacon", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for shutdown-beacon, got %d", w.Code)
	}

	// POST /api/shutdown -> 200
	req = httptest.NewRequest(http.MethodPost, "/api/shutdown", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for shutdown, got %d", w.Code)
	}
}

func TestAPI_FileReadSave_Validation(t *testing.T) {
	mgr := session.NewManager()
	api := NewAPI(mgr, nil)

	mux := http.NewServeMux()
	api.RegisterRoutes(mux)

	// 1. SSH file read without session -> 400
	req := httptest.NewRequest(http.MethodGet, "/api/ssh/file/read?sessionId=invalid&path=/test.txt", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing SSH session, got %d", w.Code)
	}

	// 2. FTP file read without session -> 400
	req = httptest.NewRequest(http.MethodGet, "/api/ftp/file/read?sessionId=invalid&path=/test.txt", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing FTP session, got %d", w.Code)
	}

	// 3. SSH file save without body -> 400
	req = httptest.NewRequest(http.MethodPost, "/api/ssh/file/save", strings.NewReader(`{}`))
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for empty save body, got %d", w.Code)
	}

	// 4. FTP file save without body -> 400
	req = httptest.NewRequest(http.MethodPost, "/api/ftp/file/save", strings.NewReader(`{}`))
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for empty save body, got %d", w.Code)
	}
}

func TestAPI_AIStatus(t *testing.T) {
	mgr := session.NewManager()
	api := NewAPI(mgr, nil)

	mux := http.NewServeMux()
	api.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/ai/status", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 status, got %d", w.Code)
	}

	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if _, ok := resp["available"]; !ok {
		t.Errorf("expected 'available' key in response")
	}
}

func TestAPI_AIChat_Validation(t *testing.T) {
	mgr := session.NewManager()
	api := NewAPI(mgr, nil)

	mux := http.NewServeMux()
	api.RegisterRoutes(mux)

	// 1. Missing prompt -> 400
	req := httptest.NewRequest(http.MethodPost, "/api/ai/chat", strings.NewReader(`{"prompt":""}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 status for empty prompt, got %d", w.Code)
	}

	// 2. Invalid json -> 400
	req = httptest.NewRequest(http.MethodPost, "/api/ai/chat", strings.NewReader(`invalid json`))
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 status for invalid json, got %d", w.Code)
	}
}

func TestAPI_AIWorkspaceAndSessions(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "pssh-api-workspace-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr := session.NewManager()
	api := NewAPI(mgr, nil)
	wm := ai.NewWorkspaceManager(tmpDir)
	api.SetWorkspaceManager(wm)

	mux := http.NewServeMux()
	api.RegisterRoutes(mux)

	hostKey := "test-host-1.local"

	// 1. GET /api/ai/sessions
	req := httptest.NewRequest(http.MethodGet, "/api/ai/sessions?hostKey="+hostKey, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for sessions list, got %d", w.Code)
	}

	// 2. GET /api/ai/knowledge (should have auto-generated CLAUDE.md)
	req = httptest.NewRequest(http.MethodGet, "/api/ai/knowledge?hostKey="+hostKey, nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for knowledge get, got %d", w.Code)
	}
	var kResp ai.KnowledgeResponse
	if err := json.NewDecoder(w.Body).Decode(&kResp); err != nil {
		t.Fatalf("failed to decode knowledge response: %v", err)
	}
	if !strings.Contains(kResp.Content, "リモートホスト運用ナレッジ") {
		t.Errorf("expected initial CLAUDE.md template content")
	}

	// 3. PUT /api/ai/knowledge
	updateBody := `{"hostKey":"` + hostKey + `","content":"# My Updated Server Notes"}`
	req = httptest.NewRequest(http.MethodPut, "/api/ai/knowledge", strings.NewReader(updateBody))
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for knowledge put, got %d", w.Code)
	}

	// Verify update
	req = httptest.NewRequest(http.MethodGet, "/api/ai/knowledge?hostKey="+hostKey, nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	var kResp2 ai.KnowledgeResponse
	_ = json.NewDecoder(w.Body).Decode(&kResp2)
	if kResp2.Content != "# My Updated Server Notes" {
		t.Errorf("knowledge content = %q; want '# My Updated Server Notes'", kResp2.Content)
	}

	// 4. Save a session and verify GET messages & DELETE
	sID := "session-abc-123"
	_ = wm.SaveSession(hostKey, sID, "Test Title", []ai.SavedChatMessage{
		{ID: "1", Role: "user", Content: "Hello"},
	})

	req = httptest.NewRequest(http.MethodGet, "/api/ai/session/"+sID+"/messages?hostKey="+hostKey, nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for get session messages, got %d", w.Code)
	}

	// DELETE
	req = httptest.NewRequest(http.MethodDelete, "/api/ai/session/"+sID+"?hostKey="+hostKey, nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for delete session, got %d", w.Code)
	}
}



