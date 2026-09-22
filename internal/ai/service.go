package ai

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

var (
	codeBlockRegex = regexp.MustCompile("(?s)```(?:bash|sh|zsh)?\\s*\\n(.*?)\\n```")

	dangerousPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive\s+--force)\s+[/~*]`),
		regexp.MustCompile(`(?i)\b(mkfs|fdisk|parted)\b`),
		regexp.MustCompile(`(?i)\bdd\s+if=`),
		regexp.MustCompile(`>\s*/dev/sd[a-z]`),
		regexp.MustCompile(`(?i)\b(shutdown|reboot|poweroff|init\s+[06])\b`),
		regexp.MustCompile(`(?i)\b(drop\s+(database|table)|truncate\s+table)\b`),
		regexp.MustCompile(`(?i)\bkill\s+-9\s+-1\b`),
		regexp.MustCompile(`(?i)\bchmod\s+(-R\s+)?777\s+/`),
	}
)

type Service struct {
	customCmdPath string
}

func NewService(customCmdPath string) *Service {
	return &Service{
		customCmdPath: customCmdPath,
	}
}

// FindClaudeCommand locates the claude executable in PATH.
func (s *Service) FindClaudeCommand() (string, error) {
	if s.customCmdPath != "" {
		p, err := exec.LookPath(s.customCmdPath)
		if err == nil {
			return p, nil
		}
		return s.customCmdPath, nil
	}

	// Try standard "claude"
	if p, err := exec.LookPath("claude"); err == nil {
		return p, nil
	}

	// On Windows, also check claude.cmd and claude.exe
	if runtime.GOOS == "windows" {
		candidates := []string{"claude.cmd", "claude.exe", "claude.bat"}
		for _, c := range candidates {
			if p, err := exec.LookPath(c); err == nil {
				return p, nil
			}
		}
	}

	// Check typical installation directories
	home, _ := os.UserHomeDir()
	var fallbackPaths []string
	if runtime.GOOS == "windows" {
		if appData := os.Getenv("APPDATA"); appData != "" {
			fallbackPaths = append(fallbackPaths, filepath.Join(appData, "npm", "claude.cmd"))
		}
		if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
			fallbackPaths = append(fallbackPaths,
				filepath.Join(localAppData, "Programs", "claude", "claude.exe"),
				filepath.Join(localAppData, "npm", "claude.cmd"),
			)
		}
		if home != "" {
			fallbackPaths = append(fallbackPaths, filepath.Join(home, ".local", "bin", "claude.exe"))
		}
	} else {
		if home != "" {
			fallbackPaths = append(fallbackPaths,
				filepath.Join(home, ".local", "bin", "claude"),
				filepath.Join(home, ".npm-global", "bin", "claude"),
			)
		}
		fallbackPaths = append(fallbackPaths,
			"/usr/local/bin/claude",
			"/opt/homebrew/bin/claude",
		)
	}

	for _, fp := range fallbackPaths {
		if fi, err := os.Stat(fp); err == nil && !fi.IsDir() {
			return fp, nil
		}
	}

	return "", fmt.Errorf("claude command not found in PATH or standard locations")
}

// CheckStatus checks if claude is installed and returns its version.
func (s *Service) CheckStatus(ctx context.Context) StatusResponse {
	cmdPath, err := s.FindClaudeCommand()
	if err != nil {
		return StatusResponse{
			Available: false,
			Error:     "claude CLI がローカル環境に見つかりません。オプション機能を利用するには Claude Code (npm i -g @anthropic-ai/claude-code) をインストールしてください。",
		}
	}

	execCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(execCtx, cmdPath, "--version")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return StatusResponse{
			Available: false,
			Command:   cmdPath,
			Error:     fmt.Sprintf("claude --version の実行に失敗しました: %v (%s)", err, strings.TrimSpace(string(out))),
		}
	}

	ver := strings.TrimSpace(string(out))
	return StatusResponse{
		Available: true,
		Version:   ver,
		Command:   cmdPath,
	}
}

// ExecuteChat runs claude -p with context and prompt.
func (s *Service) ExecuteChat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	cmdPath, err := s.FindClaudeCommand()
	if err != nil {
		return nil, fmt.Errorf("claude CLI is not available: %w", err)
	}

	fullPrompt := s.buildPrompt(req)

	// Execute with timeout (up to 90 seconds)
	execCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()

	var cmd *exec.Cmd
	// On Windows, if calling a .cmd or .bat file, invoke via cmd.exe /C if needed
	if runtime.GOOS == "windows" && (strings.HasSuffix(strings.ToLower(cmdPath), ".cmd") || strings.HasSuffix(strings.ToLower(cmdPath), ".bat")) {
		cmd = exec.CommandContext(execCtx, "cmd.exe", "/c", cmdPath, "-p", fullPrompt)
	} else {
		cmd = exec.CommandContext(execCtx, cmdPath, "-p", fullPrompt)
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		errOutput := strings.TrimSpace(stderr.String())
		if errOutput == "" {
			errOutput = strings.TrimSpace(stdout.String())
		}
		if execCtx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("Claude CLIの実行がタイムアウトしました (90秒)")
		}
		return nil, fmt.Errorf("Claude CLIの実行に失敗しました: %v (%s)", err, errOutput)
	}

	reply := stdout.String()
	commands := s.extractCommands(reply)

	return &ChatResponse{
		Reply:    reply,
		Commands: commands,
	}, nil
}

func (s *Service) buildPrompt(req ChatRequest) string {
	var sb strings.Builder

	sb.WriteString("【役割】\n")
	sb.WriteString("あなたはSSH/ターミナル操作およびLinux/Unix本番保守の高度なアシスタントです。\n")
	sb.WriteString("ユーザーから提供されたホスト情報、カレントディレクトリ、ファイル一覧、直近のターミナル出力（エラーやログ）を参考に、ユーザーの要望を満たす安全で最適なコマンドスニペットを提案してください。\n\n")

	sb.WriteString("【指示ルール】\n")
	sb.WriteString("1. 実行すべきコマンドは必ず ```bash ... ``` コードブロックで提示してください。\n")
	sb.WriteString("2. ユーザーが変更・指定すべき値（IPアドレス、ファイル名、数値等）がある場合は、{{PARAM_NAME}} の形式（例: {{TARGET_IP}}, {{PORT}}, {{KEYWORD}}）でプレースホルダにしてください。ツールのセーフティ・コマンドバーで自動入力フォームが展開されます。\n")
	sb.WriteString("3. 本番環境での誤爆を防ぐため、rm -rf などの破壊的コマンドは極力避け、確認用（ls, cat, grep, head, status等）の安全なコマンドを優先してください。危険な操作を行う場合は必ず事前に警告を添えてください。\n")
	sb.WriteString("4. コマンドの前後に、なぜそのコマンドを実行するのか、何を確認できるかの簡潔な解説を添えてください。\n\n")

	c := req.Context
	sb.WriteString("【現在のセッションコンテキスト（ユーザーに見えている画面情報）】\n")
	if c.Host != "" {
		userStr := c.User
		if userStr == "" {
			userStr = "unknown"
		}
		sb.WriteString(fmt.Sprintf("- 接続先: %s@%s (isRoot: %v)\n", userStr, c.Host, c.IsRoot))
	}
	if c.CurrentDir != "" {
		sb.WriteString(fmt.Sprintf("- リモートエクスプローラのカレントパス: %s\n", c.CurrentDir))
	}
	if len(c.Files) > 0 {
		sb.WriteString("- カレントディレクトリのファイル一覧:\n")
		// Limit to 40 items to avoid token overflow
		limit := len(c.Files)
		if limit > 40 {
			limit = 40
		}
		for i := 0; i < limit; i++ {
			f := c.Files[i]
			typeStr := "FILE"
			if f.IsDir {
				typeStr = "DIR "
			}
			sb.WriteString(fmt.Sprintf("    [%s] %s (%d bytes)\n", typeStr, f.Name, f.Size))
		}
		if len(c.Files) > 40 {
			sb.WriteString(fmt.Sprintf("    ... (他 %d 件省略)\n", len(c.Files)-40))
		}
	}
	if c.TerminalRecentOutput != "" {
		sb.WriteString("\n【直近のターミナル出力（画面ログ・直前コマンド結果）】\n")
		sb.WriteString("```\n")
		// Keep within reasonable length (last 4000 chars)
		out := c.TerminalRecentOutput
		if len(out) > 4000 {
			out = out[len(out)-4000:]
		}
		sb.WriteString(out)
		sb.WriteString("\n```\n")
	}

	if len(c.History) > 0 {
		sb.WriteString("\n【直近の会話履歴】\n")
		for _, msg := range c.History {
			role := "User"
			if msg.Role == "assistant" {
				role = "Assistant"
			}
			content := msg.Content
			if len(content) > 1000 {
				content = content[:1000] + "..."
			}
			sb.WriteString(fmt.Sprintf("[%s]: %s\n", role, content))
		}
	}

	sb.WriteString("\n【ユーザーの指示】\n")
	sb.WriteString(req.Prompt)

	return sb.String()
}

func (s *Service) extractCommands(reply string) []CommandSnippet {
	matches := codeBlockRegex.FindAllStringSubmatch(reply, -1)
	var snippets []CommandSnippet

	for _, match := range matches {
		if len(match) > 1 {
			cmdStr := strings.TrimSpace(match[1])
			if cmdStr == "" {
				continue
			}

			isDang := false
			for _, pat := range dangerousPatterns {
				if pat.MatchString(cmdStr) {
					isDang = true
					break
				}
			}

			snippets = append(snippets, CommandSnippet{
				Command:     cmdStr,
				IsDangerous: isDang,
			})
		}
	}

	return snippets
}
