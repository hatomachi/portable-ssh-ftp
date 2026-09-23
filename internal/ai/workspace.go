package ai

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	safeKeyRegex = regexp.MustCompile(`[^a-zA-Z0-9._-]`)
)

// SanitizeHostKey converts an arbitrary host string or profile into a safe directory name.
func SanitizeHostKey(key string) string {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return "default_host"
	}
	safe := safeKeyRegex.ReplaceAllString(trimmed, "_")
	for strings.Contains(safe, "__") {
		safe = strings.ReplaceAll(safe, "__", "_")
	}
	safe = strings.Trim(safe, "._-")
	if safe == "" {
		return "default_host"
	}
	return safe
}

// WorkspaceManager manages per-host workspaces, CLAUDE.md knowledge, and sessions.
type WorkspaceManager struct {
	baseDir string
	mu      sync.RWMutex
}

// NewWorkspaceManager creates a WorkspaceManager with the given base directory.
func NewWorkspaceManager(baseDir string) *WorkspaceManager {
	if baseDir == "" {
		baseDir = "workspaces"
	}
	abs, err := filepath.Abs(baseDir)
	if err == nil {
		baseDir = abs
	}
	return &WorkspaceManager{
		baseDir: baseDir,
	}
}

// GetBaseDir returns the root workspaces directory.
func (wm *WorkspaceManager) GetBaseDir() string {
	return wm.baseDir
}

// GetHostWorkspace resolves or creates the workspace directory for the host.
func (wm *WorkspaceManager) GetHostWorkspace(hostKey string) (string, error) {
	wm.mu.Lock()
	defer wm.mu.Unlock()

	safeKey := SanitizeHostKey(hostKey)
	dir := filepath.Join(wm.baseDir, safeKey)

	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("failed to create workspace dir: %w", err)
	}

	sessionsDir := filepath.Join(dir, "sessions")
	if err := os.MkdirAll(sessionsDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create sessions dir: %w", err)
	}

	claudeMdPath := filepath.Join(dir, "CLAUDE.md")
	if _, err := os.Stat(claudeMdPath); os.IsNotExist(err) {
		tmpl := fmt.Sprintf(`# リモートホスト運用ナレッジ: %s

このディレクトリは、接続先ホスト「%s」専用の AI 作業フォルダです。
Claude Code はこのフォルダ内の指示・ナレッジ（CLAUDE.md や各種メモ）を自動参照して自律調査・コマンド提案を行います。

## サーバーの役割・環境構成メモ
- ホスト識別子: %s
<!-- サーバーの用途（Web, DB, バッチ等）、主要ディレクトリ、使用サービスを記載 -->

## 注意事項・禁止操作
- 本番稼働中のサービスに影響を与える破壊的コマンド（rm -rf, shutdown, killall等）は実行禁止。
`, hostKey, hostKey, hostKey)

		_ = os.WriteFile(claudeMdPath, []byte(tmpl), 0644)
	}

	return dir, nil
}

// pathToClaudeDirName converts a workspace directory path into Claude Code's project directory name.
func pathToClaudeDirName(dirPath string) string {
	re := regexp.MustCompile(`[^a-zA-Z0-9]`)
	return re.ReplaceAllString(dirPath, "-")
}

// ListSessions lists all sessions for a specific host, merging local sessions with Claude project logs.
func (wm *WorkspaceManager) ListSessions(hostKey string) ([]AISessionSummary, error) {
	workDir, err := wm.GetHostWorkspace(hostKey)
	if err != nil {
		return nil, err
	}

	wm.mu.RLock()
	defer wm.mu.RUnlock()

	safeKey := SanitizeHostKey(hostKey)
	indexPath := filepath.Join(workDir, "sessions.json")

	sessionMap := make(map[string]AISessionSummary)

	// 1. Load internal sessions.json
	if data, err := os.ReadFile(indexPath); err == nil {
		var list []AISessionSummary
		if err := json.Unmarshal(data, &list); err == nil {
			for _, s := range list {
				if s.ID != "" {
					sessionMap[s.ID] = s
				}
			}
		}
	}

	// 2. Scan Claude Code's projects directory (~/.claude/projects) for additional sessions
	home, _ := os.UserHomeDir()
	if home != "" {
		claudeProjectsDir := filepath.Join(home, ".claude", "projects")
		targetDirName := pathToClaudeDirName(workDir)
		claudeWorkDir := filepath.Join(claudeProjectsDir, targetDirName)

		if entries, err := os.ReadDir(claudeWorkDir); err == nil {
			for _, entry := range entries {
				if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
					continue
				}
				sID := strings.TrimSuffix(entry.Name(), ".jsonl")
				filePath := filepath.Join(claudeWorkDir, entry.Name())
				fi, err := entry.Info()
				if err != nil {
					continue
				}

				existing, exists := sessionMap[sID]
				if !exists {
					title, msgCount := extractSummaryFromClaudeJsonl(filePath)
					if title == "" {
						title = "セッション " + sID[:8]
					}
					sessionMap[sID] = AISessionSummary{
						ID:           sID,
						Title:        title,
						HostKey:      safeKey,
						CreatedAt:    fi.ModTime().UTC().Format(time.RFC3339),
						UpdatedAt:    fi.ModTime().UTC().Format(time.RFC3339),
						MessageCount: msgCount,
					}
				} else if existing.MessageCount == 0 {
					_, msgCount := extractSummaryFromClaudeJsonl(filePath)
					existing.MessageCount = msgCount
					sessionMap[sID] = existing
				}
			}
		}
	}

	var results []AISessionSummary
	for _, s := range sessionMap {
		results = append(results, s)
	}

	// Sort by UpdatedAt descending
	sort.Slice(results, func(i, j int) bool {
		return results[i].UpdatedAt > results[j].UpdatedAt
	})

	return results, nil
}

// extractSummaryFromClaudeJsonl extracts title and message count from a Claude JSONL file.
func extractSummaryFromClaudeJsonl(filePath string) (string, int) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", 0
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	buf := make([]byte, 1024*1024)
	scanner.Buffer(buf, 1024*1024)

	var title string
	var firstUserPrompt string
	msgCount := 0

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var raw map[string]any
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			continue
		}

		entryType, _ := raw["type"].(string)
		if entryType == "ai-title" {
			if t, ok := raw["aiTitle"].(string); ok && t != "" {
				title = t
			}
		}

		if entryType == "user" {
			msgCount++
			if firstUserPrompt == "" {
				if msgObj, ok := raw["message"].(map[string]any); ok {
					if contentStr, ok := msgObj["content"].(string); ok {
						firstUserPrompt = contentStr
					} else if contentArr, ok := msgObj["content"].([]any); ok {
						for _, block := range contentArr {
							if blockMap, ok := block.(map[string]any); ok {
								if blockMap["type"] == "text" {
									if textStr, ok := blockMap["text"].(string); ok {
										firstUserPrompt = textStr
										break
									}
								}
							}
						}
					}
				}
			}
		}

		if entryType == "assistant" {
			msgCount++
		}
	}

	if title == "" && firstUserPrompt != "" {
		runes := []rune(firstUserPrompt)
		if len(runes) > 30 {
			title = string(runes[:30]) + "..."
		} else {
			title = string(runes)
		}
	}

	return title, msgCount
}

// GetSessionMessages returns the message history for a specific session.
func (wm *WorkspaceManager) GetSessionMessages(hostKey string, sessionID string) ([]SavedChatMessage, error) {
	workDir, err := wm.GetHostWorkspace(hostKey)
	if err != nil {
		return nil, err
	}

	wm.mu.RLock()
	defer wm.mu.RUnlock()

	sessionPath := filepath.Join(workDir, "sessions", sessionID+".json")
	if data, err := os.ReadFile(sessionPath); err == nil {
		var msgs []SavedChatMessage
		if err := json.Unmarshal(data, &msgs); err == nil {
			return msgs, nil
		}
	}

	// Fallback: parse from Claude Code's JSONL
	home, _ := os.UserHomeDir()
	if home != "" {
		targetDirName := pathToClaudeDirName(workDir)
		jsonlPath := filepath.Join(home, ".claude", "projects", targetDirName, sessionID+".jsonl")
		if _, err := os.Stat(jsonlPath); err == nil {
			msgs := parseClaudeJsonlToMessages(jsonlPath)
			if len(msgs) > 0 {
				return msgs, nil
			}
		}
	}

	return []SavedChatMessage{}, nil
}

// parseClaudeJsonlToMessages converts Claude JSONL lines into SavedChatMessage items.
func parseClaudeJsonlToMessages(filePath string) []SavedChatMessage {
	file, err := os.Open(filePath)
	if err != nil {
		return nil
	}
	defer file.Close()

	var msgs []SavedChatMessage
	scanner := bufio.NewScanner(file)
	buf := make([]byte, 1024*1024)
	scanner.Buffer(buf, 1024*1024)

	var lastInspectLogs []InspectLog

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var raw map[string]any
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			continue
		}

		entryType, _ := raw["type"].(string)

		if entryType == "user" {
			var text string
			if msgObj, ok := raw["message"].(map[string]any); ok {
				if contentStr, ok := msgObj["content"].(string); ok {
					text = contentStr
				} else if contentArr, ok := msgObj["content"].([]any); ok {
					for _, block := range contentArr {
						if blockMap, ok := block.(map[string]any); ok {
							if blockMap["type"] == "text" {
								if t, ok := blockMap["text"].(string); ok {
									text += t
								}
							} else if blockMap["type"] == "tool_result" {
								out := fmt.Sprintf("%v", blockMap["content"])
								isErr, _ := blockMap["is_error"].(bool)
								errStr := ""
								if isErr {
									errStr = out
								}
								lastInspectLogs = append(lastInspectLogs, InspectLog{
									Command: "remote_inspect",
									Output:  out,
									Error:   errStr,
								})
							}
						}
					}
				}
			}
			if text != "" {
				ts := time.Now().UnixMilli()
				if tsStr, ok := raw["timestamp"].(string); ok {
					if t, err := time.Parse(time.RFC3339, tsStr); err == nil {
						ts = t.UnixMilli()
					}
				}
				id, _ := raw["uuid"].(string)
				if id == "" {
					id = fmt.Sprintf("u-%d", ts)
				}
				msgs = append(msgs, SavedChatMessage{
					ID:        id,
					Role:      "user",
					Content:   text,
					Timestamp: ts,
				})
			}
		}

		if entryType == "assistant" {
			var text string
			var snippets []CommandSnippet
			if msgObj, ok := raw["message"].(map[string]any); ok {
				if contentArr, ok := msgObj["content"].([]any); ok {
					for _, block := range contentArr {
						if blockMap, ok := block.(map[string]any); ok {
							if blockMap["type"] == "text" {
								if t, ok := blockMap["text"].(string); ok {
									text += t
								}
							}
						}
					}
				}
			}
			if text != "" {
				ts := time.Now().UnixMilli()
				if tsStr, ok := raw["timestamp"].(string); ok {
					if t, err := time.Parse(time.RFC3339, tsStr); err == nil {
						ts = t.UnixMilli()
					}
				}
				id, _ := raw["uuid"].(string)
				if id == "" {
					id = fmt.Sprintf("a-%d", ts)
				}

				matches := codeBlockRegex.FindAllStringSubmatch(text, -1)
				for _, match := range matches {
					if len(match) > 1 {
						cmdStr := strings.TrimSpace(match[1])
						if cmdStr != "" {
							snippets = append(snippets, CommandSnippet{
								Command: cmdStr,
							})
						}
					}
				}

				msgs = append(msgs, SavedChatMessage{
					ID:          id,
					Role:        "assistant",
					Content:     text,
					Commands:    snippets,
					InspectLogs: lastInspectLogs,
					Timestamp:   ts,
				})
				lastInspectLogs = nil
			}
		}
	}

	return msgs
}

// SaveSession persists conversation messages and updates the session index.
func (wm *WorkspaceManager) SaveSession(hostKey string, sessionID string, title string, messages []SavedChatMessage) error {
	workDir, err := wm.GetHostWorkspace(hostKey)
	if err != nil {
		return err
	}

	wm.mu.Lock()
	defer wm.mu.Unlock()

	safeKey := SanitizeHostKey(hostKey)
	sessionPath := filepath.Join(workDir, "sessions", sessionID+".json")

	msgBytes, err := json.MarshalIndent(messages, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(sessionPath, msgBytes, 0644); err != nil {
		return fmt.Errorf("failed to save session messages: %w", err)
	}

	// Update sessions.json
	indexPath := filepath.Join(workDir, "sessions.json")
	var list []AISessionSummary
	if data, err := os.ReadFile(indexPath); err == nil {
		_ = json.Unmarshal(data, &list)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	found := false
	for i, s := range list {
		if s.ID == sessionID {
			if title != "" {
				list[i].Title = title
			}
			list[i].UpdatedAt = now
			list[i].MessageCount = len(messages)
			found = true
			break
		}
	}

	if !found {
		if title == "" {
			for _, m := range messages {
				if m.Role == "user" && m.Content != "" {
					runes := []rune(m.Content)
					if len(runes) > 30 {
						title = string(runes[:30]) + "..."
					} else {
						title = string(runes)
					}
					break
				}
			}
		}
		if title == "" {
			if len(sessionID) >= 8 {
				title = "セッション " + sessionID[:8]
			} else {
				title = "セッション " + sessionID
			}
		}

		list = append([]AISessionSummary{{
			ID:           sessionID,
			Title:        title,
			HostKey:      safeKey,
			CreatedAt:    now,
			UpdatedAt:    now,
			MessageCount: len(messages),
		}}, list...)
	}

	indexBytes, err := json.MarshalIndent(list, "", "  ")
	if err == nil {
		_ = os.WriteFile(indexPath, indexBytes, 0644)
	}

	return nil
}

// DeleteSession removes a session file and updates the index.
func (wm *WorkspaceManager) DeleteSession(hostKey string, sessionID string) error {
	workDir, err := wm.GetHostWorkspace(hostKey)
	if err != nil {
		return err
	}

	wm.mu.Lock()
	defer wm.mu.Unlock()

	sessionPath := filepath.Join(workDir, "sessions", sessionID+".json")
	_ = os.Remove(sessionPath)

	indexPath := filepath.Join(workDir, "sessions.json")
	var list []AISessionSummary
	if data, err := os.ReadFile(indexPath); err == nil {
		_ = json.Unmarshal(data, &list)
	}

	var updated []AISessionSummary
	for _, s := range list {
		if s.ID != sessionID {
			updated = append(updated, s)
		}
	}

	indexBytes, err := json.MarshalIndent(updated, "", "  ")
	if err == nil {
		_ = os.WriteFile(indexPath, indexBytes, 0644)
	}

	return nil
}

// GetKnowledge reads the CLAUDE.md file for the specified host.
func (wm *WorkspaceManager) GetKnowledge(hostKey string) (KnowledgeResponse, error) {
	workDir, err := wm.GetHostWorkspace(hostKey)
	if err != nil {
		return KnowledgeResponse{}, err
	}

	safeKey := SanitizeHostKey(hostKey)
	claudeMdPath := filepath.Join(workDir, "CLAUDE.md")

	data, err := os.ReadFile(claudeMdPath)
	if err != nil {
		return KnowledgeResponse{
			HostKey:       safeKey,
			WorkspacePath: workDir,
			Content:       "",
		}, nil
	}

	fi, _ := os.Stat(claudeMdPath)
	updatedAt := ""
	if fi != nil {
		updatedAt = fi.ModTime().UTC().Format(time.RFC3339)
	}

	return KnowledgeResponse{
		HostKey:       safeKey,
		WorkspacePath: workDir,
		Content:       string(data),
		UpdatedAt:     updatedAt,
	}, nil
}

// SaveKnowledge updates the CLAUDE.md file for the specified host.
func (wm *WorkspaceManager) SaveKnowledge(hostKey string, content string) error {
	workDir, err := wm.GetHostWorkspace(hostKey)
	if err != nil {
		return err
	}

	wm.mu.Lock()
	defer wm.mu.Unlock()

	claudeMdPath := filepath.Join(workDir, "CLAUDE.md")
	return os.WriteFile(claudeMdPath, []byte(content), 0644)
}
