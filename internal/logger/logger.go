package logger

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Regex to strip ANSI escape codes (CSI, OSC, etc.)
var ansiRegex = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)`)

type SessionLogger struct {
	file          *os.File
	filePath      string
	withTimestamp bool
	mu            sync.Mutex
	isNewLine     bool
	closed        bool
}

type LogInfo struct {
	Name    string    `json:"name"`
	Path    string    `json:"path"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"modTime"`
}

// NewSessionLogger creates and initializes a new logger for a session.
func NewSessionLogger(host string, port int, user string, withTimestamp bool) (*SessionLogger, error) {
	logDir := "logs"
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create logs directory: %w", err)
	}

	sanitizedHost := sanitizeHost(host)
	now := time.Now()
	timestampStr := now.Format("20060102_150405")
	baseFileName := fmt.Sprintf("%s_%s.log", timestampStr, sanitizedHost)
	filePath := filepath.Join(logDir, baseFileName)

	// Avoid overwrite if file exists with same name
	counter := 1
	for {
		if _, err := os.Stat(filePath); os.IsNotExist(err) {
			break
		}
		filePath = filepath.Join(logDir, fmt.Sprintf("%s_%s_%d.log", timestampStr, sanitizedHost, counter))
		counter++
	}

	f, err := os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to open log file %s: %w", filePath, err)
	}

	logger := &SessionLogger{
		file:          f,
		filePath:      filePath,
		withTimestamp: withTimestamp,
		isNewLine:     true,
	}

	// Write session start header
	timestampMode := "disabled"
	if withTimestamp {
		timestampMode = "enabled"
	}
	header := fmt.Sprintf(
		"================================================================================\n"+
			"Portable SSH & FTP - Terminal Session Log\n"+
			"Session Started : %s\n"+
			"Target Host     : %s:%d\n"+
			"User            : %s\n"+
			"Log File        : %s\n"+
			"Timestamps      : %s\n"+
			"================================================================================\n",
		now.Format("2006-01-02 15:04:05"),
		host, port, user, filePath, timestampMode,
	)
	if _, err := f.WriteString(header); err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("failed to write log header: %w", err)
	}

	return logger, nil
}

// Write writes raw terminal bytes to the log, optionally stripping ANSI codes and prefixing lines with timestamps.
func (l *SessionLogger) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	if l.closed || l.file == nil {
		return len(p), nil
	}

	// Strip ANSI sequences for clean evidence log
	cleanStr := ansiRegex.ReplaceAllString(string(p), "")
	if len(cleanStr) == 0 {
		return len(p), nil
	}

	if !l.withTimestamp {
		_, err := l.file.WriteString(cleanStr)
		if err != nil {
			return 0, err
		}
		return len(p), nil
	}

	// Format with timestamps
	var builder strings.Builder
	tsFormat := time.Now().Format("2006-01-02 15:04:05")

	for i := 0; i < len(cleanStr); i++ {
		ch := cleanStr[i]
		if l.isNewLine {
			// Do not print timestamp for standalone newline characters
			if ch != '\r' && ch != '\n' {
				builder.WriteString("[")
				builder.WriteString(tsFormat)
				builder.WriteString("] ")
				l.isNewLine = false
			}
		}

		builder.WriteByte(ch)

		if ch == '\n' {
			l.isNewLine = true
			tsFormat = time.Now().Format("2006-01-02 15:04:05")
		}
	}

	if builder.Len() > 0 {
		if _, err := l.file.WriteString(builder.String()); err != nil {
			return 0, err
		}
	}

	return len(p), nil
}

// FilePath returns the relative path of the log file.
func (l *SessionLogger) FilePath() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.filePath
}

// Close finishes writing the footer and closes the log file.
func (l *SessionLogger) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.closed || l.file == nil {
		return nil
	}

	now := time.Now().Format("2006-01-02 15:04:05")
	footer := fmt.Sprintf(
		"\n================================================================================\n"+
			"Session Ended   : %s\n"+
			"================================================================================\n",
		now,
	)
	_, _ = l.file.WriteString(footer)

	err := l.file.Close()
	l.closed = true
	l.file = nil
	return err
}

// ListLogs returns a list of existing log files in the logs directory.
func ListLogs() ([]LogInfo, error) {
	logDir := "logs"
	entries, err := os.ReadDir(logDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []LogInfo{}, nil
		}
		return nil, err
	}

	var logs []LogInfo
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".log") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		logs = append(logs, LogInfo{
			Name:    e.Name(),
			Path:    filepath.Join(logDir, e.Name()),
			Size:    info.Size(),
			ModTime: info.ModTime(),
		})
	}
	return logs, nil
}

func sanitizeHost(host string) string {
	var b strings.Builder
	for _, r := range host {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '-' || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	res := b.String()
	if res == "" {
		return "session"
	}
	return res
}
