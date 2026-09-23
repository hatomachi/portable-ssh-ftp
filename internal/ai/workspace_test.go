package ai

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSanitizeHostKey(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"192.168.1.10", "192.168.1.10"},
		{"user@192.168.1.10:22", "user_192.168.1.10_22"},
		{"prod-server.internal", "prod-server.internal"},
		{"", "default_host"},
		{"   ", "default_host"},
		{"db:5432/test?ssl=true", "db_5432_test_ssl_true"},
	}

	for _, tt := range tests {
		got := SanitizeHostKey(tt.input)
		if got != tt.expected {
			t.Errorf("SanitizeHostKey(%q) = %q; want %q", tt.input, got, tt.expected)
		}
	}
}

func TestWorkspaceManager(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "pssh-test-workspace-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	wm := NewWorkspaceManager(tmpDir)

	// 1. GetHostWorkspace creates dir and CLAUDE.md
	hostKey := "user@192.168.1.50:22"
	dir, err := wm.GetHostWorkspace(hostKey)
	if err != nil {
		t.Fatalf("GetHostWorkspace failed: %v", err)
	}

	claudePath := filepath.Join(dir, "CLAUDE.md")
	if _, err := os.Stat(claudePath); os.IsNotExist(err) {
		t.Errorf("CLAUDE.md should exist in workspace")
	}

	// 2. Knowledge read & write
	kResp, err := wm.GetKnowledge(hostKey)
	if err != nil {
		t.Fatalf("GetKnowledge failed: %v", err)
	}
	if kResp.Content == "" {
		t.Errorf("expected initial CLAUDE.md content, got empty")
	}

	newContent := "# Updated Knowledge\nNginx is running on port 80"
	if err := wm.SaveKnowledge(hostKey, newContent); err != nil {
		t.Fatalf("SaveKnowledge failed: %v", err)
	}
	kResp2, _ := wm.GetKnowledge(hostKey)
	if kResp2.Content != newContent {
		t.Errorf("GetKnowledge after save = %q; want %q", kResp2.Content, newContent)
	}

	// 3. Save session and ListSessions
	sID := "test-session-uuid-1234"
	msgs := []SavedChatMessage{
		{
			ID:        "m1",
			Role:      "user",
			Content:   "Nginxの設定ファイルはどこ？",
			Timestamp: 1000,
		},
		{
			ID:        "m2",
			Role:      "assistant",
			Content:   "/etc/nginx/nginx.conf です。\n```bash\ncat /etc/nginx/nginx.conf\n```",
			Timestamp: 2000,
		},
	}

	if err := wm.SaveSession(hostKey, sID, "", msgs); err != nil {
		t.Fatalf("SaveSession failed: %v", err)
	}

	sessions, err := wm.ListSessions(hostKey)
	if err != nil {
		t.Fatalf("ListSessions failed: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}
	if sessions[0].ID != sID {
		t.Errorf("session ID = %q; want %q", sessions[0].ID, sID)
	}
	if sessions[0].MessageCount != 2 {
		t.Errorf("MessageCount = %d; want 2", sessions[0].MessageCount)
	}

	// 4. GetSessionMessages
	loadedMsgs, err := wm.GetSessionMessages(hostKey, sID)
	if err != nil {
		t.Fatalf("GetSessionMessages failed: %v", err)
	}
	if len(loadedMsgs) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(loadedMsgs))
	}
	if loadedMsgs[0].Content != msgs[0].Content {
		t.Errorf("msg[0] content = %q; want %q", loadedMsgs[0].Content, msgs[0].Content)
	}

	// 5. DeleteSession
	if err := wm.DeleteSession(hostKey, sID); err != nil {
		t.Fatalf("DeleteSession failed: %v", err)
	}
	sessionsAfter, _ := wm.ListSessions(hostKey)
	if len(sessionsAfter) != 0 {
		t.Errorf("expected 0 sessions after delete, got %d", len(sessionsAfter))
	}
}
