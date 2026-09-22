package session

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"

	"portable-ssh-ftp/internal/encoding"
	"portable-ssh-ftp/internal/ftp"
	"portable-ssh-ftp/internal/logger"
	"portable-ssh-ftp/internal/ssh"
)

type Session struct {
	ID          string                `json:"id"`
	Req         ConnectRequest        `json:"-"`
	SSHConfig   ssh.Config            `json:"sshConfig"`
	FTPConfig   ftp.Config            `json:"ftpConfig"`
	SSHClient   *ssh.Client           `json:"-"`
	FTPClient   *ftp.Client           `json:"-"`
	Logger      *logger.SessionLogger `json:"-"`
	LogFilePath string                `json:"logFilePath,omitempty"`
	mu          sync.Mutex
}

type ConnectRequest struct {
	Host          string     `json:"host"`
	SSHPort       int        `json:"sshPort"`
	SSHUsername   string     `json:"sshUsername"`
	SSHPassword   string     `json:"sshPassword"`
	SSHPrivateKey string     `json:"sshPrivateKey"`
	SSHPassphrase string     `json:"sshPassphrase"`
	FTPPort       int        `json:"ftpPort"`
	FTPUsername   string     `json:"ftpUsername"`
	FTPPassword   string     `json:"ftpPassword"`
	FTPPassive    bool       `json:"ftpPassive"`
	FTPCharset    string     `json:"ftpCharset"`
	EnableSSH     bool       `json:"enableSsh"`
	EnableFTP     bool       `json:"enableFtp"`
	EnableLogging *bool      `json:"enableLogging,omitempty"`
	LogTimestamp  *bool      `json:"logTimestamp,omitempty"`
}

type Manager struct {
	sessions map[string]*Session
	activeID string
	mu       sync.RWMutex
}

func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
	}
}

func (m *Manager) CreateSession(req ConnectRequest) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Default ports
	if req.SSHPort == 0 {
		req.SSHPort = 22
	}
	if req.FTPPort == 0 {
		req.FTPPort = 21
	}

	sessionID := generateID()
	sess := &Session{
		ID:  sessionID,
		Req: req,
		SSHConfig: ssh.Config{
			Host:          req.Host,
			Port:          req.SSHPort,
			Username:      req.SSHUsername,
			Password:      req.SSHPassword,
			PrivateKey:    req.SSHPrivateKey,
			KeyPassphrase: req.SSHPassphrase,
		},
		FTPConfig: ftp.Config{
			Host:        req.Host,
			Port:        req.FTPPort,
			Username:    req.FTPUsername,
			Password:    req.FTPPassword,
			PassiveMode: req.FTPPassive,
			Charset:     encoding.CharsetUTF8,
		},
	}
	if req.FTPCharset != "" {
		sess.FTPConfig.Charset = encoding.Charset(req.FTPCharset)
	}

	var sshErr, ftpErr error

	if req.EnableSSH {
		sshClient, err := ssh.NewClient(sess.SSHConfig)
		if err != nil {
			sshErr = fmt.Errorf("ssh connection error: %w", err)
		} else {
			sess.SSHClient = sshClient
		}
	}

	if req.EnableFTP {
		ftpClient, err := ftp.NewClient(sess.FTPConfig)
		if err != nil {
			ftpErr = fmt.Errorf("ftp connection error: %w", err)
		} else {
			sess.FTPClient = ftpClient
		}
	}

	// If both were requested and both failed, return error
	if req.EnableSSH && req.EnableFTP && sshErr != nil && ftpErr != nil {
		return nil, fmt.Errorf("both ssh and ftp failed: ssh [%v], ftp [%v]", sshErr, ftpErr)
	}
	if req.EnableSSH && !req.EnableFTP && sshErr != nil {
		return nil, sshErr
	}
	if !req.EnableSSH && req.EnableFTP && ftpErr != nil {
		return nil, ftpErr
	}

	// Initialize session logger if SSH is enabled and logging is active
	enableLogging := true
	if req.EnableLogging != nil {
		enableLogging = *req.EnableLogging
	}
	logTimestamp := true
	if req.LogTimestamp != nil {
		logTimestamp = *req.LogTimestamp
	}

	if sess.SSHClient != nil && enableLogging {
		sessLogger, err := logger.NewSessionLogger(req.Host, sess.SSHConfig.Port, sess.SSHConfig.Username, logTimestamp)
		if err == nil {
			sess.Logger = sessLogger
			sess.LogFilePath = sessLogger.FilePath()
		}
	}

	m.sessions[sessionID] = sess
	m.activeID = sessionID

	return sess, nil
}

func (m *Manager) GetSession(id string) (*Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if id == "" || id == "active" {
		id = m.activeID
	}
	sess, ok := m.sessions[id]
	return sess, ok
}

func (m *Manager) CloseSession(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if id == "" || id == "active" {
		id = m.activeID
	}

	sess, ok := m.sessions[id]
	if !ok {
		return nil
	}

	sess.mu.Lock()
	defer sess.mu.Unlock()

	if sess.Logger != nil {
		_ = sess.Logger.Close()
		sess.Logger = nil
	}

	if sess.SSHClient != nil {
		_ = sess.SSHClient.Close()
		sess.SSHClient = nil
	}
	if sess.FTPClient != nil {
		_ = sess.FTPClient.Close()
		sess.FTPClient = nil
	}

	delete(m.sessions, id)
	if m.activeID == id {
		m.activeID = ""
	}
	return nil
}

func (m *Manager) DuplicateSession(id string) (*Session, error) {
	m.mu.RLock()
	if id == "" || id == "active" {
		id = m.activeID
	}

	target, ok := m.sessions[id]
	if !ok {
		m.mu.RUnlock()
		return nil, fmt.Errorf("session not found: %s", id)
	}
	req := target.Req
	m.mu.RUnlock()

	return m.CreateSession(req)
}

func (m *Manager) ReconnectSession(id string) (*Session, error) {
	m.mu.RLock()
	if id == "" || id == "active" {
		id = m.activeID
	}

	sess, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("session not found: %s", id)
	}

	sess.mu.Lock()
	defer sess.mu.Unlock()

	var lastErr error

	if sess.Req.EnableSSH {
		if sess.SSHClient != nil {
			_ = sess.SSHClient.Close()
			sess.SSHClient = nil
		}
		newSSH, err := ssh.NewClient(sess.SSHConfig)
		if err != nil {
			lastErr = fmt.Errorf("ssh reconnection failed: %w", err)
		} else {
			sess.SSHClient = newSSH
		}
	}

	if sess.Req.EnableFTP {
		if sess.FTPClient != nil {
			_ = sess.FTPClient.Close()
			sess.FTPClient = nil
		}
		newFTP, err := ftp.NewClient(sess.FTPConfig)
		if err != nil {
			if lastErr != nil {
				lastErr = fmt.Errorf("%v; ftp reconnection failed: %w", lastErr, err)
			} else {
				lastErr = fmt.Errorf("ftp reconnection failed: %w", err)
			}
		} else {
			sess.FTPClient = newFTP
		}
	}

	if lastErr != nil {
		return sess, lastErr
	}

	return sess, nil
}

type SessionSummary struct {
	ID           string `json:"id"`
	Host         string `json:"host"`
	SSHConnected bool   `json:"sshConnected"`
	FTPConnected bool   `json:"ftpConnected"`
	SSHPort      int    `json:"sshPort"`
	SSHUsername  string `json:"sshUsername"`
	FTPPort      int    `json:"ftpPort"`
	FTPUsername  string `json:"ftpUsername"`
	FTPCharset   string `json:"ftpCharset"`
	LogFilePath  string `json:"logFilePath,omitempty"`
}

func (m *Manager) ListSessions() []SessionSummary {
	m.mu.RLock()
	defer m.mu.RUnlock()

	summaries := make([]SessionSummary, 0, len(m.sessions))
	for _, sess := range m.sessions {
		summaries = append(summaries, SessionSummary{
			ID:           sess.ID,
			Host:         sess.Req.Host,
			SSHConnected: sess.SSHClient != nil,
			FTPConnected: sess.FTPClient != nil,
			SSHPort:      sess.SSHConfig.Port,
			SSHUsername:  sess.SSHConfig.Username,
			FTPPort:      sess.FTPConfig.Port,
			FTPUsername:  sess.FTPConfig.Username,
			FTPCharset:   string(sess.FTPConfig.Charset),
			LogFilePath:  sess.LogFilePath,
		})
	}
	return summaries
}

func generateID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
