package ai

import (
	"testing"
)

func TestExtractCommands(t *testing.T) {
	svc := NewService("")

	sampleReply := `
エラーログを確認するには、以下のコマンドを実行します。

` + "```bash\n" + `grep -i "error" /var/log/nginx/error.log | head -n 20` + "\n```" + `

危険なコマンドの例:
` + "```sh\n" + `rm -rf /tmp/test` + "\n```" + `

通常コマンド:
` + "```\n" + `systemctl status nginx` + "\n```"

	commands := svc.extractCommands(sampleReply)
	if len(commands) != 3 {
		t.Fatalf("expected 3 commands, got %d", len(commands))
	}

	if commands[0].Command != `grep -i "error" /var/log/nginx/error.log | head -n 20` {
		t.Errorf("unexpected command 0: %s", commands[0].Command)
	}
	if commands[0].IsDangerous {
		t.Errorf("command 0 should not be dangerous")
	}

	if commands[1].Command != `rm -rf /tmp/test` {
		t.Errorf("unexpected command 1: %s", commands[1].Command)
	}
	if !commands[1].IsDangerous {
		t.Errorf("command 1 should be flagged as dangerous")
	}

	if commands[2].Command != `systemctl status nginx` {
		t.Errorf("unexpected command 2: %s", commands[2].Command)
	}
}

func TestBuildPrompt(t *testing.T) {
	svc := NewService("")

	req := ChatRequest{
		Prompt: "エラーログを調べて",
		Context: ChatContext{
			Host:       "192.168.1.100",
			User:       "admin",
			CurrentDir: "/var/log",
			Files: []FileItem{
				{Name: "syslog", Size: 1024, IsDir: false},
				{Name: "nginx", Size: 4096, IsDir: true},
			},
			TerminalRecentOutput: "bash: command not found",
		},
	}

	prompt := svc.buildPrompt(req)
	if prompt == "" {
		t.Fatal("prompt should not be empty")
	}

	expectedSubstrings := []string{
		"192.168.1.100",
		"/var/log",
		"syslog",
		"bash: command not found",
		"エラーログを調べて",
		"{{PARAM_NAME}}",
	}

	for _, s := range expectedSubstrings {
		if !testingContains(prompt, s) {
			t.Errorf("expected prompt to contain %q", s)
		}
	}
}

func testingContains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 || (len(s) > 0 && len(substr) > 0 && searchSubstr(s, substr)))
}

func searchSubstr(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func TestFindClaudeCommand(t *testing.T) {
	svc := NewService("")
	cmdPath, err := svc.FindClaudeCommand()
	if err != nil {
		t.Logf("claude CLI is not installed (expected in some CI environments): %v", err)
		return
	}
	t.Logf("Found claude at: %s", cmdPath)
	if cmdPath == "" {
		t.Errorf("cmdPath should not be empty")
	}
}

