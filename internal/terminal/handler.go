package terminal

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strconv"
	"sync"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
	"portable-ssh-ftp/internal/session"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for local app
	},
}

type ControlMessage struct {
	Type string `json:"type"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

type Handler struct {
	mgr *session.Manager
}

func NewHandler(mgr *session.Manager) *Handler {
	return &Handler{mgr: mgr}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sessionId")
	sess, ok := h.mgr.GetSession(sessionID)
	if !ok || sess.SSHClient == nil {
		http.Error(w, "SSH session not found or not connected", http.StatusBadRequest)
		return
	}

	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Failed to upgrade websocket: %v", err)
		return
	}
	defer ws.Close()

	sshSession, err := sess.SSHClient.NewSession()
	if err != nil {
		_ = ws.WriteMessage(websocket.TextMessage, []byte("\r\n\x1b[31mFailed to create SSH session: "+err.Error()+"\x1b[0m\r\n"))
		return
	}
	defer sshSession.Close()

	cols := 80
	rows := 24
	if c, err := strconv.Atoi(r.URL.Query().Get("cols")); err == nil && c > 0 {
		cols = c
	}
	if r, err := strconv.Atoi(r.URL.Query().Get("rows")); err == nil && r > 0 {
		rows = r
	}

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}

	if err := sshSession.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		_ = ws.WriteMessage(websocket.TextMessage, []byte("\r\n\x1b[31mFailed to request PTY: "+err.Error()+"\x1b[0m\r\n"))
		return
	}

	stdinPipe, err := sshSession.StdinPipe()
	if err != nil {
		_ = ws.WriteMessage(websocket.TextMessage, []byte("\r\n\x1b[31mFailed to get stdin pipe: "+err.Error()+"\x1b[0m\r\n"))
		return
	}
	defer stdinPipe.Close()

	stdoutPipe, err := sshSession.StdoutPipe()
	if err != nil {
		_ = ws.WriteMessage(websocket.TextMessage, []byte("\r\n\x1b[31mFailed to get stdout pipe: "+err.Error()+"\x1b[0m\r\n"))
		return
	}

	stderrPipe, err := sshSession.StderrPipe()
	if err != nil {
		_ = ws.WriteMessage(websocket.TextMessage, []byte("\r\n\x1b[31mFailed to get stderr pipe: "+err.Error()+"\x1b[0m\r\n"))
		return
	}

	if err := sshSession.Shell(); err != nil {
		_ = ws.WriteMessage(websocket.TextMessage, []byte("\r\n\x1b[31mFailed to start shell: "+err.Error()+"\x1b[0m\r\n"))
		return
	}

	var wsMutex sync.Mutex
	writeWS := func(msgType int, data []byte) error {
		wsMutex.Lock()
		defer wsMutex.Unlock()
		return ws.WriteMessage(msgType, data)
	}

	// SSH -> WebSocket forwarder
	forwardOutput := func(reader io.Reader) {
		buf := make([]byte, 4096)
		for {
			n, err := reader.Read(buf)
			if n > 0 {
				if writeErr := writeWS(websocket.BinaryMessage, buf[:n]); writeErr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}

	go forwardOutput(stdoutPipe)
	go forwardOutput(stderrPipe)

	// WebSocket -> SSH forwarder
	for {
		msgType, message, err := ws.ReadMessage()
		if err != nil {
			break
		}

		if msgType == websocket.TextMessage {
			// Check if control message (e.g. resize)
			var ctrl ControlMessage
			if err := json.Unmarshal(message, &ctrl); err == nil && ctrl.Type == "resize" {
				if ctrl.Cols > 0 && ctrl.Rows > 0 {
					_ = sshSession.WindowChange(ctrl.Rows, ctrl.Cols)
				}
				continue
			}
		}

		// Plain input or BinaryMessage
		if _, err := stdinPipe.Write(message); err != nil {
			break
		}
	}
}
