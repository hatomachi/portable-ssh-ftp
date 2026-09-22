package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type mockMCPExecutor struct {
	lastCmd string
	output  string
	err     error
}

func (m *mockMCPExecutor) RunCommandWithLimit(ctx context.Context, cmd string, maxBytes int64) (string, error) {
	m.lastCmd = cmd
	return m.output, m.err
}

func TestBuildSafeShellCommand(t *testing.T) {
	allowed := map[string]bool{
		"ls":        true,
		"cat":       true,
		"df":        true,
		"systemctl": true,
	}

	tests := []struct {
		name      string
		cmd       string
		args      []string
		wantCmd   string
		expectErr bool
	}{
		{
			name:      "Valid ls with flags and path",
			cmd:       "ls",
			args:      []string{"-la", "/var/log"},
			wantCmd:   "ls '-la' '/var/log'",
			expectErr: false,
		},
		{
			name:      "Valid df -h",
			cmd:       "df",
			args:      []string{"-h"},
			wantCmd:   "df '-h'",
			expectErr: false,
		},
		{
			name:      "Unallowed command",
			cmd:       "rm",
			args:      []string{"-rf", "/tmp"},
			expectErr: true,
		},
		{
			name:      "Prohibited pipe symbol",
			cmd:       "ls",
			args:      []string{"/tmp", "|", "cat"},
			expectErr: true,
		},
		{
			name:      "Prohibited redirect symbol",
			cmd:       "cat",
			args:      []string{"foo", ">", "bar"},
			expectErr: true,
		},
		{
			name:      "Prohibited command chaining",
			cmd:       "ls",
			args:      []string{"/tmp; rm -rf /"},
			expectErr: true,
		},
		{
			name:      "Sensitive shadow file",
			cmd:       "cat",
			args:      []string{"/etc/shadow"},
			expectErr: true,
		},
		{
			name:      "Sensitive private key",
			cmd:       "cat",
			args:      []string{"/home/user/.ssh/id_rsa"},
			expectErr: true,
		},
		{
			name:      "Dangerous find -exec",
			cmd:       "find",
			args:      []string{".", "-exec", "rm", "{}"},
			expectErr: true,
		},
		{
			name:      "Valid systemctl status",
			cmd:       "systemctl",
			args:      []string{"status", "nginx"},
			wantCmd:   "systemctl 'status' 'nginx'",
			expectErr: false,
		},
		{
			name:      "Prohibited systemctl restart",
			cmd:       "systemctl",
			args:      []string{"restart", "nginx"},
			expectErr: true,
		},
		{
			name:      "Prohibited systemctl stop",
			cmd:       "systemctl",
			args:      []string{"stop", "nginx"},
			expectErr: true,
		},
		{
			name:      "systemctl without subcommand",
			cmd:       "systemctl",
			args:      []string{},
			expectErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := BuildSafeShellCommand(tt.cmd, tt.args, allowed)
			if tt.expectErr {
				if err == nil {
					t.Errorf("expected error, got nil (cmd: %s)", got)
				}
			} else {
				if err != nil {
					t.Errorf("unexpected error: %v", err)
				}
				if got != tt.wantCmd {
					t.Errorf("got %q, want %q", got, tt.wantCmd)
				}
			}
		})
	}
}

func TestMCPServer_ServeHTTP(t *testing.T) {
	mock := &mockMCPExecutor{
		output: "file1.txt\nfile2.txt\n",
	}

	server := NewMCPServer("secret-token", mock, []string{"ls", "cat", "df"})

	// 1. Initialize
	t.Run("initialize", func(t *testing.T) {
		reqBody := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`
		r := httptest.NewRequest(http.MethodPost, "/mcp?token=secret-token", strings.NewReader(reqBody))
		w := httptest.NewRecorder()

		server.ServeHTTP(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}

		var res JSONRPCResponse
		json.NewDecoder(w.Body).Decode(&res)
		resultMap, ok := res.Result.(map[string]any)
		if !ok || resultMap["protocolVersion"] != "2024-11-05" {
			t.Errorf("unexpected initialize result: %v", res.Result)
		}
	})

	// 2. Tools/List
	t.Run("tools/list", func(t *testing.T) {
		reqBody := `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`
		r := httptest.NewRequest(http.MethodPost, "/mcp?token=secret-token", strings.NewReader(reqBody))
		w := httptest.NewRecorder()

		server.ServeHTTP(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}

		var res JSONRPCResponse
		json.NewDecoder(w.Body).Decode(&res)
		resultMap := res.Result.(map[string]any)
		tools := resultMap["tools"].([]any)
		if len(tools) != 1 {
			t.Fatalf("expected 1 tool, got %d", len(tools))
		}
		tool := tools[0].(map[string]any)
		if tool["name"] != "remote_inspect" {
			t.Errorf("expected tool name remote_inspect, got %v", tool["name"])
		}
	})

	// 3. Tools/Call - Success
	t.Run("tools/call success", func(t *testing.T) {
		reqBody := `{
			"jsonrpc": "2.0",
			"id": 3,
			"method": "tools/call",
			"params": {
				"name": "remote_inspect",
				"arguments": {
					"command": "ls",
					"args": ["-la", "/var/log"],
					"reason": "check log directory"
				}
			}
		}`
		r := httptest.NewRequest(http.MethodPost, "/mcp?token=secret-token", strings.NewReader(reqBody))
		w := httptest.NewRecorder()

		server.ServeHTTP(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}

		if mock.lastCmd != "ls '-la' '/var/log'" {
			t.Errorf("expected executed command ls '-la' '/var/log', got %q", mock.lastCmd)
		}

		logs := server.GetLogs()
		if len(logs) != 1 || logs[0].Command != "ls '-la' '/var/log'" || logs[0].Blocked {
			t.Errorf("unexpected logs: %+v", logs)
		}
	})

	// 4. Tools/Call - Blocked (unallowed command)
	t.Run("tools/call blocked unallowed", func(t *testing.T) {
		reqBody := `{
			"jsonrpc": "2.0",
			"id": 4,
			"method": "tools/call",
			"params": {
				"name": "remote_inspect",
				"arguments": {
					"command": "rm",
					"args": ["-rf", "/"],
					"reason": "malicious call"
				}
			}
		}`
		r := httptest.NewRequest(http.MethodPost, "/mcp?token=secret-token", strings.NewReader(reqBody))
		w := httptest.NewRecorder()

		server.ServeHTTP(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}

		var res JSONRPCResponse
		json.NewDecoder(w.Body).Decode(&res)
		resultMap := res.Result.(map[string]any)
		if resultMap["isError"] != true {
			t.Errorf("expected isError to be true, got %v", resultMap["isError"])
		}

		logs := server.GetLogs()
		if len(logs) != 2 || !logs[1].Blocked {
			t.Errorf("expected blocked log, got: %+v", logs)
		}
	})

	// 5. Unauthorized token
	t.Run("unauthorized", func(t *testing.T) {
		reqBody := `{"jsonrpc":"2.0","id":5,"method":"tools/list"}`
		r := httptest.NewRequest(http.MethodPost, "/mcp?token=wrong-token", bytes.NewBufferString(reqBody))
		w := httptest.NewRecorder()

		server.ServeHTTP(w, r)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", w.Code)
		}
	})
}
