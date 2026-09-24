package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

var DefaultAllowedCommands = []string{
	"ls", "cat", "head", "tail", "grep", "wc", "stat",
	"df", "free", "uptime", "uname", "date",
	"ps", "systemctl",
	"ss", "which", "ip",
}

type JSONRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type JSONRPCResponse struct {
	JSONRPC string `json:"jsonrpc"`
	ID      any    `json:"id"`
	Result  any    `json:"result,omitempty"`
	Error   any    `json:"error,omitempty"`
}

type ToolCallParams struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

type RemoteInspectArgs struct {
	Command string   `json:"command"`
	Args    []string `json:"args"`
	Reason  string   `json:"reason,omitempty"`
}

type MCPServer struct {
	token           string
	executor        RemoteExecutor
	allowedCommands []string
	allowedMap      map[string]bool
	logsMu          sync.Mutex
	logs            []InspectLog
}

func NewMCPServer(token string, executor RemoteExecutor, allowed []string) *MCPServer {
	cmds := allowed
	if len(cmds) == 0 {
		cmds = make([]string, len(DefaultAllowedCommands))
		copy(cmds, DefaultAllowedCommands)
	}

	m := make(map[string]bool, len(cmds))
	for _, c := range cmds {
		trimmed := strings.TrimSpace(c)
		if trimmed != "" {
			m[trimmed] = true
		}
	}

	return &MCPServer{
		token:           token,
		executor:        executor,
		allowedCommands: cmds,
		allowedMap:      m,
	}
}

func (s *MCPServer) GetLogs() []InspectLog {
	s.logsMu.Lock()
	defer s.logsMu.Unlock()
	res := make([]InspectLog, len(s.logs))
	copy(res, s.logs)
	return res
}

func (s *MCPServer) addLog(log InspectLog) {
	s.logsMu.Lock()
	defer s.logsMu.Unlock()
	s.logs = append(s.logs, log)
}

// BuildSafeShellCommand validates and escapes the command and arguments.
func BuildSafeShellCommand(cmd string, args []string, allowed map[string]bool) (string, error) {
	trimmedCmd := strings.TrimSpace(cmd)
	if trimmedCmd == "" {
		return "", fmt.Errorf("コマンド名が空です")
	}

	if !allowed[trimmedCmd] {
		return "", fmt.Errorf("コマンド '%s' は許可リストに含まれていません", trimmedCmd)
	}

	if len(args) > 8 {
		return "", fmt.Errorf("引数の数が多すぎます（最大8個まで）")
	}

	for _, arg := range args {
		if len(arg) > 256 {
			return "", fmt.Errorf("引数が長すぎます（最大256文字）: %s", arg)
		}
		if forbiddenSymbolsRegex.MatchString(arg) {
			return "", fmt.Errorf("禁止文字または演算子が含まれています (| > < ; & ` $): %s", arg)
		}

		lower := strings.ToLower(arg)
		for _, sensitive := range sensitiveKeywords {
			if strings.Contains(lower, sensitive) {
				return "", fmt.Errorf("機密ファイル（%s）へのアクセスは禁止されています", sensitive)
			}
		}

		// Block dangerous flags for read commands
		if (trimmedCmd == "find" && (strings.Contains(lower, "-exec") || strings.Contains(lower, "-delete"))) ||
			(trimmedCmd == "sed" && strings.Contains(lower, "-i")) {
			return "", fmt.Errorf("危険なフラグまたは書き込みオプションは禁止されています: %s", arg)
		}
	}

	// Restrict systemctl to safe read-only subcommands
	if trimmedCmd == "systemctl" {
		if len(args) == 0 {
			return "", fmt.Errorf("systemctlには確認用サブコマンド（status, is-active等）の指定が必要です")
		}
		subCmd := strings.ToLower(args[0])
		if subCmd != "status" && subCmd != "is-active" && subCmd != "is-failed" && subCmd != "is-enabled" && subCmd != "list-units" {
			return "", fmt.Errorf("systemctlのサブコマンド '%s' は許可されていません（許可: status, is-active, is-failed, is-enabled, list-units）", subCmd)
		}
	}

	// Build safe escaped command line
	var b strings.Builder
	b.WriteString(trimmedCmd)
	for _, arg := range args {
		trimmedArg := strings.TrimSpace(arg)
		if trimmedArg == "" {
			continue
		}
		b.WriteString(" '")
		b.WriteString(strings.ReplaceAll(trimmedArg, "'", "'\\''"))
		b.WriteString("'")
	}

	return b.String(), nil
}

func (s *MCPServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Validate token
	reqToken := r.URL.Query().Get("token")
	if reqToken == "" {
		authHeader := r.Header.Get("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			reqToken = strings.TrimPrefix(authHeader, "Bearer ")
		}
	}

	if s.token != "" && reqToken != s.token {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}

	var req JSONRPCRequest
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "Invalid JSON-RPC request", http.StatusBadRequest)
		return
	}

	var res JSONRPCResponse
	res.JSONRPC = "2.0"
	res.ID = req.ID

	switch req.Method {
	case "server/discover":
		res.Result = map[string]any{
			"protocolVersion": "2026-07-28",
			"capabilities": map[string]any{
				"tools": map[string]any{},
			},
			"serverInfo": map[string]any{
				"name":    "sshinspect",
				"version": "1.0.0",
			},
		}

	case "initialize":
		res.Result = map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities": map[string]any{
				"tools": map[string]any{},
			},
			"serverInfo": map[string]any{
				"name":    "sshinspect",
				"version": "1.0.0",
			},
		}

	case "notifications/initialized":
		w.WriteHeader(http.StatusOK)
		return

	case "tools/list":
		res.Result = map[string]any{
			"tools": []map[string]any{
				{
					"name": "remote_inspect",
					"description": "接続中のリモートLinuxサーバー上で、読み取り専用の調査コマンドを1つ実行し、stdout/stderrを返します。" +
						"カレントパスやサーバーのファイル・リソース調査に使用してください。シェルを介したパイプやリダイレクトは使えません。" +
						"許可外のコマンドや引数はエラーになりますので、その場合は別の許可コマンドで調査を継続してください。",
					"inputSchema": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"command": map[string]any{
								"type":        "string",
								"enum":        s.allowedCommands,
								"description": "実行する許可コマンド名",
							},
							"args": map[string]any{
								"type": "array",
								"items": map[string]any{
									"type": "string",
								},
								"description": "コマンドの引数配列（例: [\"-la\", \"/var/log\"] や [\"-h\"]）。パイプやリダイレクトは不可。",
							},
							"reason": map[string]any{
								"type":        "string",
								"description": "このコマンドで何を確かめたいかの調査目的（UI表示用）",
							},
						},
						"required":             []string{"command"},
						"additionalProperties": false,
					},
				},
			},
		}

	case "tools/call":
		var params ToolCallParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			res.Error = map[string]any{"code": -32602, "message": "Invalid params"}
			break
		}

		if params.Name != "remote_inspect" && params.Name != "mcp__sshinspect__remote_inspect" {
			res.Error = map[string]any{"code": -32601, "message": fmt.Sprintf("Unknown tool: %s", params.Name)}
			break
		}

		var args RemoteInspectArgs
		if err := json.Unmarshal(params.Arguments, &args); err != nil {
			res.Error = map[string]any{"code": -32602, "message": "Invalid tool arguments"}
			break
		}

		// Validate & build safe command
		fullCmd, valErr := BuildSafeShellCommand(args.Command, args.Args, s.allowedMap)
		if valErr != nil {
			s.addLog(InspectLog{
				Command: fmt.Sprintf("%s %s", args.Command, strings.Join(args.Args, " ")),
				Reason:  args.Reason,
				Error:   valErr.Error(),
				Blocked: true,
			})

			res.Result = map[string]any{
				"content": []map[string]any{
					{
						"type": "text",
						"text": fmt.Sprintf("コマンド実行エラー: %s。許可されているコマンド（%s）を使用してください。", valErr.Error(), strings.Join(s.allowedCommands, ", ")),
					},
				},
				"isError": true,
			}
			break
		}

		// Execute command on remote host
		if s.executor == nil {
			res.Result = map[string]any{
				"content": []map[string]any{
					{
						"type": "text",
						"text": "エラー: リモートSSHセッションが接続されていません。",
					},
				},
				"isError": true,
			}
			break
		}

		startTime := time.Now()
		execCtx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
		out, runErr := s.executor.RunCommandWithLimit(execCtx, fullCmd, 16*1024)
		cancel()

		durStr := fmt.Sprintf("%dms", time.Since(startTime).Milliseconds())
		logItem := InspectLog{
			Command:  fullCmd,
			Reason:   args.Reason,
			Output:   strings.TrimSpace(out),
			Duration: durStr,
			Blocked:  false,
		}

		if runErr != nil {
			logItem.Error = runErr.Error()
			s.addLog(logItem)
			res.Result = map[string]any{
				"content": []map[string]any{
					{
						"type": "text",
						"text": fmt.Sprintf("実行エラー: %s\n%s", runErr.Error(), out),
					},
				},
				"isError": true,
			}
		} else {
			s.addLog(logItem)
			res.Result = map[string]any{
				"content": []map[string]any{
					{
						"type": "text",
						"text": strings.TrimSpace(out),
					},
				},
				"isError": false,
			}
		}

	default:
		res.Error = map[string]any{
			"code":    -32601,
			"message": fmt.Sprintf("Method not found: %s", req.Method),
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}
