package logger

import (
	"os"
	"strings"
	"testing"
)

func TestSessionLogger_WithTimestamp(t *testing.T) {
	// Clean up test logs after test
	defer os.RemoveAll("logs")

	l, err := NewSessionLogger("192.168.1.100", 22, "testuser", true)
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}

	testData := []byte("echo hello\r\nhello\r\n\x1b[32mcolored line\x1b[0m\r\n")
	if _, err := l.Write(testData); err != nil {
		t.Fatalf("Failed to write to logger: %v", err)
	}

	path := l.FilePath()
	if err := l.Close(); err != nil {
		t.Fatalf("Failed to close logger: %v", err)
	}

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("Failed to read log file: %v", err)
	}

	strContent := string(content)

	// Check header
	if !strings.Contains(strContent, "Portable SSH & FTP - Terminal Session Log") {
		t.Errorf("Log missing header: %s", strContent)
	}
	if !strings.Contains(strContent, "Target Host     : 192.168.1.100:22") {
		t.Errorf("Log missing target host: %s", strContent)
	}
	if !strings.Contains(strContent, "Timestamps      : enabled") {
		t.Errorf("Log missing timestamp mode: %s", strContent)
	}

	// Check timestamp prefix
	if !strings.Contains(strContent, "] echo hello") {
		t.Errorf("Log missing timestamp prefix for echo hello: %s", strContent)
	}
	if !strings.Contains(strContent, "] hello") {
		t.Errorf("Log missing timestamp prefix for hello: %s", strContent)
	}
	if !strings.Contains(strContent, "] colored line") {
		t.Errorf("Log missing timestamp prefix for colored line: %s", strContent)
	}

	// ANSI should be stripped
	if strings.Contains(strContent, "\x1b[32m") {
		t.Errorf("ANSI codes were not stripped: %s", strContent)
	}

	// Check footer
	if !strings.Contains(strContent, "Session Ended") {
		t.Errorf("Log missing footer: %s", strContent)
	}
}

func TestSessionLogger_WithoutTimestamp(t *testing.T) {
	defer os.RemoveAll("logs")

	l, err := NewSessionLogger("example.com:8080", 22, "admin", false)
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}

	testData := []byte("plain command output\r\n")
	if _, err := l.Write(testData); err != nil {
		t.Fatalf("Failed to write: %v", err)
	}

	path := l.FilePath()
	_ = l.Close()

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("Failed to read log: %v", err)
	}

	str := string(content)
	if !strings.Contains(str, "Timestamps      : disabled") {
		t.Errorf("Expected disabled timestamp mode: %s", str)
	}
	if !strings.Contains(str, "plain command output\r\n") {
		t.Errorf("Expected plain output without timestamp prefix: %s", str)
	}
}

func TestSanitizeHost(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"192.168.1.1", "192.168.1.1"},
		{"server-01.local", "server-01.local"},
		{"user@host:2222", "user_host_2222"},
		{"", "session"},
	}

	for _, tt := range tests {
		got := sanitizeHost(tt.input)
		if got != tt.expected {
			t.Errorf("sanitizeHost(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

func TestListLogs(t *testing.T) {
	defer os.RemoveAll("logs")

	l, _ := NewSessionLogger("host1", 22, "u1", true)
	_ = l.Close()

	logs, err := ListLogs()
	if err != nil {
		t.Fatalf("ListLogs failed: %v", err)
	}
	if len(logs) != 1 {
		t.Errorf("Expected 1 log file, got %d", len(logs))
	}
}
