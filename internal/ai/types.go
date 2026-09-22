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
	Reply       string           `json:"reply"`
	Commands    []CommandSnippet `json:"commands"`
	InspectLogs []InspectLog     `json:"inspectLogs,omitempty"`
}

