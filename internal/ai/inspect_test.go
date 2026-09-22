package ai

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestValidateSafeCommand_Allowed(t *testing.T) {
	allowedList := []string{
		"ls -la /var/log",
		"ls -lha /etc/nginx",
		"ls /var/log/nginx",
		"cat /etc/nginx/nginx.conf",
		"cat -n /var/log/app.log",
		"cat /var/log/messages",
		"head -n 20 /var/log/syslog",
		"head /etc/hosts",
		"tail -n 50 /var/log/nginx/access.log",
		"tail /var/log/nginx/error.log",
		`grep -i "error" /var/log/nginx/error.log`,
		"grep 404 /var/log/nginx/access.log",
		"which nginx",
		"which python3",
		"command -v curl",
		"uname -a",
		"uname -r",
	}

	for _, cmd := range allowedList {
		if err := ValidateSafeCommand(cmd); err != nil {
			t.Errorf("expected command %q to be allowed, but got error: %v", cmd, err)
		}
	}
}

func TestValidateSafeCommand_Blocked(t *testing.T) {
	blockedCases := []struct {
		cmd    string
		reason string
	}{
		{"", "empty command"},
		{"   ", "whitespace only"},
		{"ls -la | grep foo", "pipe operator"},
		{"cat file > out.txt", "write redirect"},
		{"cat file >> out.txt", "append redirect"},
		{"cat < in.txt", "input redirect"},
		{"ls -la; rm -rf /", "semicolon chain"},
		{"ls && whoami", "AND chain"},
		{"ls || echo fail", "OR chain"},
		{"cat `whoami`", "backtick substitution"},
		{"cat $(whoami)", "dollar substitution"},
		{"ls\nrm -rf /", "newline injection"},
		{"cat /etc/shadow", "shadow file"},
		{"cat /etc/passwd", "passwd file"},
		{"cat ~/.ssh/id_rsa", "ssh private key rsa"},
		{"cat ~/.ssh/id_ed25519", "ssh private key ed25519"},
		{"cat /path/to/server.pem", "pem certificate/key"},
		{"cat /path/to/app.key", "key file"},
		{"cat .env", "env file"},
		{"cat credentials.json", "credentials file"},
		{"sudo ls -la", "sudo root escalation"},
		{"su -", "su root escalation"},
		{"rm -rf /tmp/foo", "rm command not allowed"},
		{"chmod 755 /var/www", "chmod not allowed"},
		{"curl https://example.com", "curl not allowed"},
		{"wget https://example.com", "wget not allowed"},
		{"python script.py", "python not allowed"},
		{"sh script.sh", "sh not allowed"},
		{"find / -name nginx.conf", "find not allowed"},
		{"cat", "cat without argument"},
		{"grep", "grep without argument"},
		{"grep pattern", "grep without file argument"},
		{"which", "which without argument"},
		{"command", "command without -v"},
		{"command ls", "command without -v"},
	}

	for _, tc := range blockedCases {
		err := ValidateSafeCommand(tc.cmd)
		if err == nil {
			t.Errorf("expected command %q (%s) to be blocked, but was allowed", tc.cmd, tc.reason)
		}
	}
}

func TestParseInspectCommands(t *testing.T) {
	sampleReply1 := `
INSPECT:
ls -la /var/log/nginx
cat /etc/nginx/nginx.conf
`
	cmds1 := parseInspectCommands(sampleReply1)
	if len(cmds1) != 2 {
		t.Fatalf("expected 2 commands, got %d: %v", len(cmds1), cmds1)
	}
	if cmds1[0] != "ls -la /var/log/nginx" || cmds1[1] != "cat /etc/nginx/nginx.conf" {
		t.Errorf("unexpected commands: %v", cmds1)
	}

	sampleReply2 := `
INSPECT:
- ls -lh /var/log
- cat /etc/issue
`
	cmds2 := parseInspectCommands(sampleReply2)
	if len(cmds2) != 2 {
		t.Fatalf("expected 2 commands, got %d: %v", len(cmds2), cmds2)
	}
	if cmds2[0] != "ls -lh /var/log" || cmds2[1] != "cat /etc/issue" {
		t.Errorf("unexpected list commands: %v", cmds2)
	}

	sampleReplyNone := `
NONE
`
	cmdsNone := parseInspectCommands(sampleReplyNone)
	if len(cmdsNone) != 0 {
		t.Errorf("expected 0 commands for NONE, got: %v", cmdsNone)
	}

	sampleReplyExcess := `
INSPECT:
ls -la /
cat /etc/hosts
which nginx
`
	cmdsExcess := parseInspectCommands(sampleReplyExcess)
	if len(cmdsExcess) != 2 {
		t.Errorf("expected capped at 2 commands, got %d", len(cmdsExcess))
	}
}

type mockExecutor struct {
	outputs map[string]string
}

func (m *mockExecutor) RunCommandWithLimit(ctx context.Context, cmd string, maxBytes int64) (string, error) {
	if out, ok := m.outputs[cmd]; ok {
		return out, nil
	}
	return "", fmt.Errorf("command not found in mock: %s", cmd)
}

func TestBuildInspectPlanPrompt(t *testing.T) {
	svc := NewService("")
	req := ChatRequest{
		Prompt: "Nginxのアクセスログから404が多いURLを集計して",
		Context: ChatContext{
			Host:       "prod-web-01",
			User:       "nginx",
			CurrentDir: "/var/log",
			Files:      []FileItem{{Name: "nginx", IsDir: true}},
		},
	}

	planPrompt := svc.buildInspectPlanPrompt(req)
	if !strings.Contains(planPrompt, "INSPECT:") {
		t.Errorf("plan prompt should contain INSPECT:")
	}
	if !strings.Contains(planPrompt, "NONE") {
		t.Errorf("plan prompt should contain NONE")
	}
	if !strings.Contains(planPrompt, "prod-web-01") {
		t.Errorf("plan prompt should contain host")
	}
	if !strings.Contains(planPrompt, "Nginxのアクセスログから404が多いURLを集計して") {
		t.Errorf("plan prompt should contain user prompt")
	}
}

func TestBuildPromptWithLogs(t *testing.T) {
	svc := NewService("")
	req := ChatRequest{
		Prompt: "エラーログの確認",
		Context: ChatContext{
			Host: "10.0.0.1",
		},
	}
	logs := []InspectLog{
		{
			Command:  "ls -la /var/log/nginx",
			Output:   "access.log error.log",
			Duration: "45ms",
			Blocked:  false,
		},
		{
			Command: "cat /etc/shadow",
			Error:   "access to sensitive credential or password file (shadow) is prohibited",
			Blocked: true,
		},
	}

	prompt := svc.buildPromptWithLogs(req, logs)
	if !strings.Contains(prompt, "【AI自律環境調査の結果（裏SSHで安全に取得した実環境データ）】") {
		t.Errorf("expected inspection results section in prompt")
	}
	if !strings.Contains(prompt, "ls -la /var/log/nginx") {
		t.Errorf("expected command in prompt")
	}
	if !strings.Contains(prompt, "access.log error.log") {
		t.Errorf("expected output in prompt")
	}
	if !strings.Contains(prompt, "安全ガードレールによりブロック") {
		t.Errorf("expected blocked explanation in prompt")
	}
}
