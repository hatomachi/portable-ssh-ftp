package ai

type StatusResponse struct {
	Available bool   `json:"available"`
	Version   string `json:"version,omitempty"`
	Command   string `json:"command,omitempty"`
	Error     string `json:"error,omitempty"`
}

type FileItem struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	IsDir   bool   `json:"isDir"`
	ModTime string `json:"modTime,omitempty"`
}

type ChatContext struct {
	SessionID            string        `json:"sessionId,omitempty"`
	Host                 string        `json:"host,omitempty"`
	User                 string        `json:"user,omitempty"`
	IsRoot               bool          `json:"isRoot,omitempty"`
	CurrentDir           string        `json:"currentDir,omitempty"`
	Files                []FileItem    `json:"files,omitempty"`
	TerminalRecentOutput string        `json:"terminalRecentOutput,omitempty"`
	History              []ChatMessage `json:"history,omitempty"`
}

type ChatMessage struct {
	Role    string `json:"role"` // "user" or "assistant"
	Content string `json:"content"`
}

type ChatRequest struct {
	Prompt          string      `json:"prompt"`
	Context         ChatContext `json:"context"`
	Model           string      `json:"model,omitempty"`
	AutoInspect     bool        `json:"autoInspect"`
	AllowedCommands []string    `json:"allowedCommands,omitempty"`
	SessionID       string      `json:"sessionId,omitempty"`
	HostKey         string      `json:"hostKey,omitempty"`
	IsResume        bool        `json:"isResume,omitempty"`
}

type CommandSnippet struct {
	Command     string `json:"command"`
	Description string `json:"description,omitempty"`
	IsDangerous bool   `json:"isDangerous"`
}

// InspectLog records the safe inspection command execution result.
type InspectLog struct {
	Command  string `json:"command"`
	Reason   string `json:"reason,omitempty"`
	Output   string `json:"output"`
	Error    string `json:"error,omitempty"`
	Duration string `json:"duration,omitempty"`
	Blocked  bool   `json:"blocked,omitempty"`
}

type ChatResponse struct {
	SessionID   string           `json:"sessionId,omitempty"`
	Reply       string           `json:"reply"`
	Commands    []CommandSnippet `json:"commands"`
	InspectLogs []InspectLog     `json:"inspectLogs,omitempty"`
}

// AISessionSummary represents a conversation session metadata.
type AISessionSummary struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	HostKey      string `json:"hostKey"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
	MessageCount int    `json:"messageCount"`
}

// SavedChatMessage represents a stored message item with full rich data.
type SavedChatMessage struct {
	ID          string           `json:"id"`
	Role        string           `json:"role"` // "user" or "assistant"
	Content     string           `json:"content"`
	Commands    []CommandSnippet `json:"commands,omitempty"`
	InspectLogs []InspectLog     `json:"inspectLogs,omitempty"`
	Timestamp   int64            `json:"timestamp"`
}

// KnowledgeResponse represents the content of CLAUDE.md for a host workspace.
type KnowledgeResponse struct {
	HostKey       string `json:"hostKey"`
	WorkspacePath string `json:"workspacePath"`
	Content       string `json:"content"`
	UpdatedAt     string `json:"updatedAt,omitempty"`
}

// SaveKnowledgeRequest represents a request to update CLAUDE.md.
type SaveKnowledgeRequest struct {
	HostKey string `json:"hostKey"`
	Content string `json:"content"`
}

