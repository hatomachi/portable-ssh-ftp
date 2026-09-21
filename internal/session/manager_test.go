package session

import (
	"testing"
)

func TestManager_GetAndCloseSession(t *testing.T) {
	mgr := NewManager()

	// Direct injection for unit testing without live network
	sessID := "test-sess-1"
	req := ConnectRequest{
		Host:        "192.168.1.100",
		SSHPort:     22,
		SSHUsername: "admin",
		EnableSSH:   true,
	}
	mgr.sessions[sessID] = &Session{
		ID:  sessID,
		Req: req,
	}
	mgr.activeID = sessID

	// Test GetSession by ID
	sess, ok := mgr.GetSession(sessID)
	if !ok || sess == nil {
		t.Fatalf("expected session to be found")
	}
	if sess.Req.Host != "192.168.1.100" {
		t.Errorf("expected host 192.168.1.100, got %s", sess.Req.Host)
	}

	// Test GetSession by "active"
	activeSess, ok := mgr.GetSession("active")
	if !ok || activeSess == nil {
		t.Fatalf("expected active session to be found")
	}
	if activeSess.ID != sessID {
		t.Errorf("expected active session ID %s, got %s", sessID, activeSess.ID)
	}

	// Test ListSessions
	summaries := mgr.ListSessions()
	if len(summaries) != 1 {
		t.Fatalf("expected 1 session summary, got %d", len(summaries))
	}
	if summaries[0].ID != sessID || summaries[0].Host != "192.168.1.100" {
		t.Errorf("unexpected summary: %+v", summaries[0])
	}

	// Test CloseSession
	err := mgr.CloseSession(sessID)
	if err != nil {
		t.Fatalf("CloseSession failed: %v", err)
	}

	_, ok = mgr.GetSession(sessID)
	if ok {
		t.Errorf("expected session to be deleted")
	}
	if mgr.activeID != "" {
		t.Errorf("expected activeID to be empty, got %s", mgr.activeID)
	}
}

func TestManager_DuplicateSession_NotFound(t *testing.T) {
	mgr := NewManager()
	_, err := mgr.DuplicateSession("non-existent")
	if err == nil {
		t.Fatalf("expected error when duplicating non-existent session, got nil")
	}
}
