package ftp

import (
	"bytes"
	"fmt"
	"io"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/jlaffaye/ftp"
	"portable-ssh-ftp/internal/encoding"
)

type Config struct {
	Host        string           `json:"host"`
	Port        int              `json:"port"`
	Username    string           `json:"username"`
	Password    string           `json:"password"`
	PassiveMode bool             `json:"passiveMode"`
	Charset     encoding.Charset `json:"charset"`
}

type FileEntry struct {
	Name    string    `json:"name"`
	Path    string    `json:"path"`
	Size    uint64    `json:"size"`
	IsDir   bool      `json:"isDir"`
	ModTime time.Time `json:"modTime"`
	Mode    string    `json:"mode"`
}

type Client struct {
	cfg  Config
	conn *ftp.ServerConn
	mu   sync.Mutex
}

func NewClient(cfg Config) (*Client, error) {
	if cfg.Port == 0 {
		cfg.Port = 21
	}
	if cfg.Charset == "" {
		cfg.Charset = encoding.CharsetUTF8
	}

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	dialOpts := []ftp.DialOption{
		ftp.DialWithTimeout(10 * time.Second),
	}
	if !cfg.PassiveMode {
		dialOpts = append(dialOpts, ftp.DialWithDisabledEPSV(true))
	}

	conn, err := ftp.Dial(addr, dialOpts...)
	if err != nil {
		return nil, fmt.Errorf("failed to dial ftp server %s: %w", addr, err)
	}

	if err := conn.Login(cfg.Username, cfg.Password); err != nil {
		_ = conn.Quit()
		return nil, fmt.Errorf("ftp login failed for user %s: %w", cfg.Username, err)
	}

	return &Client{
		cfg:  cfg,
		conn: conn,
	}, nil
}

func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != nil {
		err := c.conn.Quit()
		c.conn = nil
		return err
	}
	return nil
}

func (c *Client) CurrentDir() (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil {
		return "", fmt.Errorf("ftp not connected")
	}
	rawDir, err := c.conn.CurrentDir()
	if err != nil {
		return "", err
	}
	return encoding.Decode([]byte(rawDir), c.cfg.Charset)
}

func (c *Client) ChangeDir(remotePath string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil {
		return fmt.Errorf("ftp not connected")
	}
	encodedPath, err := encoding.Encode(remotePath, c.cfg.Charset)
	if err != nil {
		return fmt.Errorf("encoding error: %w", err)
	}
	return c.conn.ChangeDir(string(encodedPath))
}

func (c *Client) List(remotePath string) ([]FileEntry, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil {
		return nil, fmt.Errorf("ftp not connected")
	}

	encodedPath, err := encoding.Encode(remotePath, c.cfg.Charset)
	if err != nil {
		return nil, fmt.Errorf("encoding error: %w", err)
	}

	target := string(encodedPath)
	if target == "" {
		target = "."
	}

	entries, err := c.conn.List(target)
	if err != nil {
		return nil, fmt.Errorf("failed to list directory %s: %w", remotePath, err)
	}

	var results []FileEntry
	for _, entry := range entries {
		name, err := encoding.Decode([]byte(entry.Name), c.cfg.Charset)
		if err != nil {
			name = entry.Name
		}
		if name == "." || name == ".." {
			continue
		}

		entryPath := path.Join(remotePath, name)
		if strings.HasPrefix(remotePath, "/") && !strings.HasPrefix(entryPath, "/") {
			entryPath = "/" + entryPath
		}

		results = append(results, FileEntry{
			Name:    name,
			Path:    entryPath,
			Size:    entry.Size,
			IsDir:   entry.Type == ftp.EntryTypeFolder,
			ModTime: entry.Time,
			Mode:    fmt.Sprintf("%v", entry.Type),
		})
	}

	return results, nil
}

func (c *Client) Download(remotePath string) (io.ReadCloser, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil {
		return nil, fmt.Errorf("ftp not connected")
	}

	encodedPath, err := encoding.Encode(remotePath, c.cfg.Charset)
	if err != nil {
		return nil, fmt.Errorf("encoding error: %w", err)
	}

	resp, err := c.conn.Retr(string(encodedPath))
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve file %s: %w", remotePath, err)
	}

	return resp, nil
}

func (c *Client) Upload(remotePath string, data io.Reader) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil {
		return fmt.Errorf("ftp not connected")
	}

	encodedPath, err := encoding.Encode(remotePath, c.cfg.Charset)
	if err != nil {
		return fmt.Errorf("encoding error: %w", err)
	}

	err = c.conn.Stor(string(encodedPath), data)
	if err != nil {
		return fmt.Errorf("failed to upload file %s: %w", remotePath, err)
	}

	return nil
}

func (c *Client) Delete(remotePath string, isDir bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil {
		return fmt.Errorf("ftp not connected")
	}

	encodedPath, err := encoding.Encode(remotePath, c.cfg.Charset)
	if err != nil {
		return fmt.Errorf("encoding error: %w", err)
	}

	target := string(encodedPath)
	if isDir {
		return c.conn.RemoveDirRecur(target)
	}
	return c.conn.Delete(target)
}

func (c *Client) MakeDir(remotePath string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil {
		return fmt.Errorf("ftp not connected")
	}

	encodedPath, err := encoding.Encode(remotePath, c.cfg.Charset)
	if err != nil {
		return fmt.Errorf("encoding error: %w", err)
	}

	return c.conn.MakeDir(string(encodedPath))
}

// ReadFileFull downloads and reads the remote file up to maxBytes (default MaxEditableFileSize = 2MB).
// Checks for binary data and detects line endings.
func (c *Client) ReadFileFull(remotePath string, maxBytes int64) (*encoding.FileReadResult, error) {
	if maxBytes <= 0 {
		maxBytes = encoding.MaxEditableFileSize
	}

	reader, err := c.Download(remotePath)
	if err != nil {
		return nil, fmt.Errorf("failed to download ftp file %s: %w", remotePath, err)
	}
	defer reader.Close()

	limitedReader := io.LimitReader(reader, maxBytes+1)
	data, err := io.ReadAll(limitedReader)
	if err != nil {
		return nil, fmt.Errorf("failed to read ftp file data %s: %w", remotePath, err)
	}

	totalSize := int64(len(data))
	truncated := totalSize > maxBytes
	name := path.Base(remotePath)

	if truncated {
		data = data[:maxBytes]
		previewLen := len(data)
		if previewLen > 65536 {
			previewLen = 65536
		}
		decoded, _ := encoding.Decode(data[:previewLen], c.cfg.Charset)
		return &encoding.FileReadResult{
			Path:           remotePath,
			Name:           name,
			Size:           totalSize,
			Content:        decoded,
			LineEnding:     encoding.DetectLineEnding(data),
			Charset:        string(c.cfg.Charset),
			Truncated:      true,
			IsBinary:       encoding.IsBinary(data),
			Editable:       false,
			ReadonlyReason: "FILE_TOO_LARGE",
		}, nil
	}

	isBin := encoding.IsBinary(data)
	lineEnding := encoding.DetectLineEnding(data)
	decoded, decErr := encoding.Decode(data, c.cfg.Charset)
	if decErr != nil {
		decoded = string(data)
	}

	editable := !isBin
	var readonlyReason string
	if isBin {
		readonlyReason = "BINARY_FILE"
	}

	return &encoding.FileReadResult{
		Path:           remotePath,
		Name:           name,
		Size:           int64(len(data)),
		Content:        decoded,
		LineEnding:     lineEnding,
		Charset:        string(c.cfg.Charset),
		Truncated:      false,
		IsBinary:       isBin,
		Editable:       editable,
		ReadonlyReason: readonlyReason,
	}, nil
}

// SaveFile normalizes line endings, encodes with FTP charset, creates backup if requested, and uploads.
func (c *Client) SaveFile(remotePath string, content string, targetLineEnding encoding.LineEnding, createBackup bool) (*encoding.FileSaveResult, error) {
	if remotePath == "" {
		return nil, fmt.Errorf("remotePath cannot be empty")
	}

	// 1. Line ending normalization
	normalized := encoding.NormalizeLineEnding(content, targetLineEnding)
	appliedEnding := encoding.DetectLineEnding([]byte(normalized))
	if appliedEnding == encoding.LineEndingNone {
		appliedEnding = targetLineEnding
	}

	// 2. Character encoding
	encodedBytes, err := encoding.Encode(normalized, c.cfg.Charset)
	if err != nil {
		return nil, fmt.Errorf("failed to encode content with charset %s: %w", c.cfg.Charset, err)
	}

	var backupPath string
	if createBackup {
		backupPath = fmt.Sprintf("%s.%s.bak", remotePath, time.Now().Format("20060102_150405"))
		if origReader, err := c.Download(remotePath); err == nil {
			_ = c.Upload(backupPath, origReader)
			origReader.Close()
		}
	}

	// 3. Upload new content
	if err := c.Upload(remotePath, bytes.NewReader(encodedBytes)); err != nil {
		return nil, fmt.Errorf("failed to upload saved file to %s: %w", remotePath, err)
	}

	return &encoding.FileSaveResult{
		Status:     "saved",
		Path:       remotePath,
		BackupPath: backupPath,
		Size:       int64(len(encodedBytes)),
		LineEnding: appliedEnding,
	}, nil
}

