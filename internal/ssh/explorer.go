package ssh

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/sftp"
	"portable-ssh-ftp/internal/encoding"
)

// FileEntry represents a remote file or directory item.
type FileEntry struct {
	Name    string    `json:"name"`
	Path    string    `json:"path"`
	Size    uint64    `json:"size"`
	IsDir   bool      `json:"isDir"`
	ModTime time.Time `json:"modTime"`
	Mode    string    `json:"mode"`
}

// ListFiles lists files in targetPath.

// If targetPath is empty or ".", it lists the current directory / home directory.
// Returns the resolved absolute path and the list of FileEntry items.
func (c *Client) ListFiles(targetPath string) (string, []FileEntry, error) {
	// Try SFTP first
	sftpClient, err := c.GetSFTPClient()
	if err == nil {
		resolvedPath, entries, sftpErr := c.listSFTP(sftpClient, targetPath)
		if sftpErr == nil {
			return resolvedPath, entries, nil
		}
		// Reset SFTP client in case connection got corrupted
		c.ResetSFTPClient()
	}

	// Fallback to SSH exec (POSIX shell + ls)
	return c.listExec(targetPath)
}

func (c *Client) listSFTP(client *sftp.Client, targetPath string) (string, []FileEntry, error) {
	var resolved string
	var err error

	if targetPath == "" || targetPath == "." || targetPath == "~" {
		resolved, err = client.RealPath(".")
		if err != nil {
			resolved = "/"
		}
	} else {
		resolved, err = client.RealPath(targetPath)
		if err != nil {
			resolved = path.Clean(targetPath)
		}
	}

	infos, err := client.ReadDir(resolved)
	if err != nil {
		return "", nil, fmt.Errorf("sftp read dir failed for %s: %w", resolved, err)
	}

	var entries []FileEntry
	for _, fi := range infos {
		name := fi.Name()
		if name == "." || name == ".." {
			continue
		}

		itemPath := path.Join(resolved, name)
		if strings.HasPrefix(resolved, "/") && !strings.HasPrefix(itemPath, "/") {
			itemPath = "/" + itemPath
		}

		isDir := fi.IsDir()
		// If symlink, attempt to stat target to check if it's a directory
		if fi.Mode()&os.ModeSymlink != 0 {
			if targetFi, err := client.Stat(itemPath); err == nil {
				isDir = targetFi.IsDir()
			}
		}

		var size uint64
		if fi.Size() > 0 {
			size = uint64(fi.Size())
		}

		entries = append(entries, FileEntry{
			Name:    name,
			Path:    itemPath,
			Size:    size,
			IsDir:   isDir,
			ModTime: fi.ModTime(),
			Mode:    fi.Mode().String(),
		})
	}

	return resolved, entries, nil
}

func (c *Client) listExec(targetPath string) (string, []FileEntry, error) {
	session, err := c.NewSession()
	if err != nil {
		return "", nil, fmt.Errorf("failed to create ssh session: %w", err)
	}
	defer session.Close()

	// Script:
	// 1. cd to target or current dir
	// 2. print pwd (delimiter line)
	// 3. list files with GNU --time-style if possible, or fallback standard ls -la
	script := fmt.Sprintf(`sh -c 't=%s
if [ -z "$t" ] || [ "$t" = "." ]; then
  pwd
else
  cd "$t" 2>/dev/null && pwd || { echo "CHDIR_FAILED:$t" >&2; exit 1; }
fi
ls -la --time-style=+%%Y-%%m-%%dT%%H:%%M:%%SZ 2>/dev/null || ls -la
'`, quoteShellArg(targetPath))

	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	if err := session.Run(script); err != nil {
		errMsg := strings.TrimSpace(stderr.String())
		if errMsg == "" {
			errMsg = err.Error()
		}
		return "", nil, fmt.Errorf("ssh exec ls failed: %s", errMsg)
	}

	output := stdout.String()
	lines := strings.Split(output, "\n")
	if len(lines) == 0 {
		return "", nil, fmt.Errorf("empty output from remote host")
	}

	currentDir := strings.TrimSpace(lines[0])
	if currentDir == "" {
		currentDir = "/"
	}

	lsOutput := strings.Join(lines[1:], "\n")
	entries := ParseLsOutput(lsOutput, currentDir)

	return currentDir, entries, nil
}

// ReadFileHead reads the first maxBytes of targetPath for file preview.
func (c *Client) ReadFileHead(targetPath string, maxBytes int64) (string, int64, bool, error) {
	if maxBytes <= 0 {
		maxBytes = 65536 // 64KB default
	}
	if maxBytes > 1048576 {
		maxBytes = 1048576 // 1MB max preview limit
	}

	// Try SFTP first
	sftpClient, err := c.GetSFTPClient()
	if err == nil {
		content, totalSize, truncated, sftpErr := c.readFileHeadSFTP(sftpClient, targetPath, maxBytes)
		if sftpErr == nil {
			return content, totalSize, truncated, nil
		}
		c.ResetSFTPClient()
	}

	// Fallback to SSH exec
	return c.readFileHeadExec(targetPath, maxBytes)
}

func (c *Client) readFileHeadSFTP(client *sftp.Client, targetPath string, maxBytes int64) (string, int64, bool, error) {
	fi, err := client.Stat(targetPath)
	if err != nil {
		return "", 0, false, fmt.Errorf("stat failed for %s: %w", targetPath, err)
	}

	totalSize := fi.Size()
	file, err := client.Open(targetPath)
	if err != nil {
		return "", 0, false, fmt.Errorf("open failed for %s: %w", targetPath, err)
	}
	defer file.Close()

	buf := make([]byte, maxBytes)
	n, _ := io.ReadFull(file, buf)
	data := buf[:n]

	truncated := totalSize > int64(n)
	decoded, err := encoding.Decode(data, encoding.CharsetUTF8)
	if err != nil {
		decoded = string(data)
	}

	return decoded, totalSize, truncated, nil
}

func (c *Client) readFileHeadExec(targetPath string, maxBytes int64) (string, int64, bool, error) {
	session, err := c.NewSession()
	if err != nil {
		return "", 0, false, fmt.Errorf("failed to create ssh session: %w", err)
	}
	defer session.Close()

	// Script: print size via wc -c, delimiter, then head
	script := fmt.Sprintf(`sh -c 'f=%s
if [ ! -f "$f" ]; then
  echo "NOT_A_REGULAR_FILE" >&2
  exit 1
fi
wc -c < "$f" 2>/dev/null || echo "-1"
echo "---HEADER_SEP---"
head -c %d "$f" 2>/dev/null || head -n 500 "$f"
'`, quoteShellArg(targetPath), maxBytes)

	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	if err := session.Run(script); err != nil {
		errMsg := strings.TrimSpace(stderr.String())
		if errMsg == "" {
			errMsg = err.Error()
		}
		return "", 0, false, fmt.Errorf("failed to read file: %s", errMsg)
	}

	raw := stdout.Bytes()
	sep := []byte("---HEADER_SEP---\n")
	idx := bytes.Index(raw, sep)

	var totalSize int64 = -1
	var contentBytes []byte

	if idx != -1 {
		sizeStr := strings.TrimSpace(string(raw[:idx]))
		if s, err := strconv.ParseInt(sizeStr, 10, 64); err == nil {
			totalSize = s
		}
		contentBytes = raw[idx+len(sep):]
	} else {
		contentBytes = raw
	}

	if totalSize == -1 {
		totalSize = int64(len(contentBytes))
	}

	truncated := totalSize > int64(len(contentBytes))
	decoded, err := encoding.Decode(contentBytes, encoding.CharsetUTF8)
	if err != nil {
		decoded = string(contentBytes)
	}

	return decoded, totalSize, truncated, nil
}

// Regex patterns for ls -la parsing
var (
	// ISO format: -rw-r--r-- 1 user group 1234 2026-09-21T12:00:00Z filename
	// or:         -rw-r--r-- 1 user group 1234 2026-09-21 12:00:00 filename
	reIsoLs = regexp.MustCompile(`^([dl\-cbps][rwxstST\-]{9}[+.]?)\s+\d+\s+\S+\s+(?:\S+\s+)?(\d+)\s+(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)\s+(.*)$`)

	// Standard POSIX / BSD format: -rw-r--r-- 1 user group 1234 Sep 21 12:00 filename
	// or:                          -rw-r--r-- 1 user group 1234 Sep 21  2025 filename
	reStandardLs = regexp.MustCompile(`^([dl\-cbps][rwxstST\-]{9}[+.]?)\s+\d+\s+\S+\s+(?:\S+\s+)?(\d+)\s+([A-Za-z]{3}\s+\d+\s+(?:\d{2}:\d{2}|\d{4}))\s+(.*)$`)
)

// ParseLsOutput parses the stdout of ls -la into FileEntry structs.
func ParseLsOutput(output string, baseDir string) []FileEntry {
	var entries []FileEntry
	lines := strings.Split(output, "\n")
	now := time.Now()

	for _, line := range lines {
		line = strings.TrimRight(line, "\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "total ") {
			continue
		}

		var modeStr, sizeStr, dateStr, namePart string

		if m := reIsoLs.FindStringSubmatch(trimmed); len(m) == 5 {
			modeStr = m[1]
			sizeStr = m[2]
			dateStr = m[3]
			namePart = m[4]
		} else if m := reStandardLs.FindStringSubmatch(trimmed); len(m) == 5 {
			modeStr = m[1]
			sizeStr = m[2]
			dateStr = m[3]
			namePart = m[4]
		} else {
			// Fallback: split whitespace
			fields := strings.Fields(trimmed)
			if len(fields) >= 8 && len(fields[0]) >= 10 {
				modeStr = fields[0]
				if modeStr[0] == 'd' || modeStr[0] == '-' || modeStr[0] == 'l' {
					sizeStr = fields[4]
					dateStr = fields[5] + " " + fields[6] + " " + fields[7]
					if len(fields) > 8 {
						namePart = strings.Join(fields[8:], " ")
					}
				}
			}
		}

		if modeStr == "" || namePart == "" {
			continue
		}

		// Handle symlink display: "name -> target"
		rawName := namePart
		if idx := strings.Index(namePart, " -> "); idx != -1 {
			rawName = namePart[:idx]
		}

		rawName = strings.TrimSpace(rawName)
		if rawName == "." || rawName == ".." || rawName == "" {
			continue
		}

		isDir := modeStr[0] == 'd'
		size, _ := strconv.ParseUint(sizeStr, 10, 64)

		itemPath := path.Join(baseDir, rawName)
		if strings.HasPrefix(baseDir, "/") && !strings.HasPrefix(itemPath, "/") {
			itemPath = "/" + itemPath
		}

		modTime := parseLsTime(dateStr, now)

		entries = append(entries, FileEntry{
			Name:    rawName,
			Path:    itemPath,
			Size:    size,
			IsDir:   isDir,
			ModTime: modTime,
			Mode:    modeStr,
		})
	}

	return entries
}

func parseLsTime(s string, now time.Time) time.Time {
	s = strings.TrimSpace(s)
	// Try ISO RFC3339
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	}
	// Try ISO standard
	if t, err := time.Parse("2006-01-02 15:04:05", s); err == nil {
		return t
	}
	if t, err := time.Parse("2006-01-02 15:04", s); err == nil {
		return t
	}

	// Try Month Day Time (e.g. Sep 21 12:00) -> current year
	cleaned := strings.Join(strings.Fields(s), " ")
	if t, err := time.Parse("Jan 2 15:04", cleaned); err == nil {
		return time.Date(now.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), 0, 0, now.Location())
	}
	// Try Month Day Year (e.g. Sep 21 2025)
	if t, err := time.Parse("Jan 2 2006", cleaned); err == nil {
		return t
	}

	return now
}

func quoteShellArg(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

// StatFile retrieves the file name and size of a remote file.
func (c *Client) StatFile(remotePath string) (string, int64, error) {
	filename := path.Base(remotePath)

	// Try SFTP first
	sftpClient, err := c.GetSFTPClient()
	if err == nil {
		fi, sftpErr := sftpClient.Stat(remotePath)
		if sftpErr == nil {
			return filename, fi.Size(), nil
		}
		c.ResetSFTPClient()
	}

	// Fallback to SSH exec
	session, err := c.NewSession()
	if err != nil {
		return filename, -1, fmt.Errorf("failed to create ssh session: %w", err)
	}
	defer session.Close()

	script := fmt.Sprintf(`sh -c 'f=%s
if [ ! -e "$f" ]; then
  echo "NOT_FOUND" >&2
  exit 1
fi
wc -c < "$f" 2>/dev/null || echo "-1"
'`, quoteShellArg(remotePath))

	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	if err := session.Run(script); err != nil {
		return filename, -1, fmt.Errorf("failed to stat file: %s", strings.TrimSpace(stderr.String()))
	}

	sizeStr := strings.TrimSpace(stdout.String())
	size, err := strconv.ParseInt(sizeStr, 10, 64)
	if err != nil {
		size = -1
	}

	return filename, size, nil
}

// UploadFile uploads a file to remote targetDir with filename.
// If targetDir is empty, uploads to current/home directory.
// Returns the uploaded full remote path.
func (c *Client) UploadFile(targetDir string, filename string, r io.Reader, size int64, mode os.FileMode) (string, error) {
	if filename == "" {
		return "", fmt.Errorf("filename cannot be empty")
	}

	// Try SFTP first
	sftpClient, err := c.GetSFTPClient()
	if err == nil {
		destDir := targetDir
		if destDir == "" || destDir == "." || destDir == "~" {
			if real, err := sftpClient.RealPath("."); err == nil {
				destDir = real
			} else {
				destDir = "/"
			}
		}

		remotePath := path.Join(destDir, filename)
		if strings.HasPrefix(destDir, "/") && !strings.HasPrefix(remotePath, "/") {
			remotePath = "/" + remotePath
		}

		remoteFile, sftpErr := sftpClient.Create(remotePath)
		if sftpErr == nil {
			defer remoteFile.Close()
			if _, copyErr := io.Copy(remoteFile, r); copyErr != nil {
				return "", fmt.Errorf("sftp upload copy error: %w", copyErr)
			}
			if mode != 0 {
				_ = sftpClient.Chmod(remotePath, mode)
			}
			return remotePath, nil
		}
		c.ResetSFTPClient()
	}

	// Fallback to SSH exec (cat > targetPath)
	session, err := c.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create ssh session for upload: %w", err)
	}
	defer session.Close()

	destDir := targetDir
	if destDir == "" || destDir == "." {
		destDir = "."
	}
	remotePath := path.Join(destDir, filename)
	if strings.HasPrefix(destDir, "/") && !strings.HasPrefix(remotePath, "/") {
		remotePath = "/" + remotePath
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		return "", fmt.Errorf("failed to open stdin pipe: %w", err)
	}

	var stderr bytes.Buffer
	session.Stderr = &stderr

	script := fmt.Sprintf("cat > %s", quoteShellArg(remotePath))
	if err := session.Start(script); err != nil {
		stdin.Close()
		return "", fmt.Errorf("failed to start upload command: %w", err)
	}

	if _, err := io.Copy(stdin, r); err != nil {
		stdin.Close()
		return "", fmt.Errorf("failed writing to remote stdin: %w", err)
	}
	stdin.Close()

	if err := session.Wait(); err != nil {
		return "", fmt.Errorf("upload failed: %s", strings.TrimSpace(stderr.String()))
	}

	if mode != 0 {
		if chmodSess, err := c.NewSession(); err == nil {
			_ = chmodSess.Run(fmt.Sprintf("chmod %o %s", mode&0777, quoteShellArg(remotePath)))
			chmodSess.Close()
		}
	}

	return remotePath, nil
}

// DownloadFile streams the remote file content to writer w.
func (c *Client) DownloadFile(remotePath string, w io.Writer) error {
	if remotePath == "" {
		return fmt.Errorf("remotePath cannot be empty")
	}

	// Try SFTP first
	sftpClient, err := c.GetSFTPClient()
	if err == nil {
		remoteFile, sftpErr := sftpClient.Open(remotePath)
		if sftpErr == nil {
			defer remoteFile.Close()
			_, copyErr := io.Copy(w, remoteFile)
			return copyErr
		}
		c.ResetSFTPClient()
	}

	// Fallback to SSH exec (cat remotePath)
	session, err := c.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create ssh session for download: %w", err)
	}
	defer session.Close()

	var stderr bytes.Buffer
	session.Stdout = w
	session.Stderr = &stderr

	script := fmt.Sprintf("cat %s", quoteShellArg(remotePath))
	if err := session.Run(script); err != nil {
		errMsg := strings.TrimSpace(stderr.String())
		if errMsg == "" {
			errMsg = err.Error()
		}
		return fmt.Errorf("ssh cat failed: %s", errMsg)
	}

	return nil
}

// ReadFileFull reads the entire file up to maxBytes (default MaxEditableFileSize = 2MB).
// Checks for binary data and detects line endings.
func (c *Client) ReadFileFull(targetPath string, maxBytes int64, charset encoding.Charset) (*encoding.FileReadResult, error) {
	if maxBytes <= 0 {
		maxBytes = encoding.MaxEditableFileSize
	}
	if charset == "" {
		charset = encoding.CharsetUTF8
	}

	// Try SFTP first
	sftpClient, err := c.GetSFTPClient()
	if err == nil {
		res, sftpErr := c.readFileFullSFTP(sftpClient, targetPath, maxBytes, charset)
		if sftpErr == nil {
			return res, nil
		}
		c.ResetSFTPClient()
	}

	// Fallback to SSH exec
	return c.readFileFullExec(targetPath, maxBytes, charset)
}

func (c *Client) readFileFullSFTP(client *sftp.Client, targetPath string, maxBytes int64, charset encoding.Charset) (*encoding.FileReadResult, error) {
	fi, err := client.Stat(targetPath)
	if err != nil {
		return nil, fmt.Errorf("stat failed for %s: %w", targetPath, err)
	}

	totalSize := fi.Size()
	name := fi.Name()

	file, err := client.Open(targetPath)
	if err != nil {
		return nil, fmt.Errorf("open failed for %s: %w", targetPath, err)
	}
	defer file.Close()

	if totalSize > maxBytes {
		// Read only up to 64KB for preview if file is too large
		buf := make([]byte, 65536)
		n, _ := io.ReadFull(file, buf)
		previewData := buf[:n]
		decoded, _ := encoding.Decode(previewData, charset)
		return &encoding.FileReadResult{
			Path:           targetPath,
			Name:           name,
			Size:           totalSize,
			Content:        decoded,
			LineEnding:     encoding.DetectLineEnding(previewData),
			Charset:        string(charset),
			Truncated:      true,
			IsBinary:       encoding.IsBinary(previewData),
			Editable:       false,
			ReadonlyReason: "FILE_TOO_LARGE",
		}, nil
	}

	// Read all data
	data, err := io.ReadAll(file)
	if err != nil {
		return nil, fmt.Errorf("read failed for %s: %w", targetPath, err)
	}

	isBin := encoding.IsBinary(data)
	lineEnding := encoding.DetectLineEnding(data)
	decoded, decErr := encoding.Decode(data, charset)
	if decErr != nil {
		decoded = string(data)
	}

	editable := !isBin
	var readonlyReason string
	if isBin {
		readonlyReason = "BINARY_FILE"
	}

	return &encoding.FileReadResult{
		Path:           targetPath,
		Name:           name,
		Size:           totalSize,
		Content:        decoded,
		LineEnding:     lineEnding,
		Charset:        string(charset),
		Truncated:      false,
		IsBinary:       isBin,
		Editable:       editable,
		ReadonlyReason: readonlyReason,
	}, nil
}

func (c *Client) readFileFullExec(targetPath string, maxBytes int64, charset encoding.Charset) (*encoding.FileReadResult, error) {
	name, totalSize, err := c.StatFile(targetPath)
	if err != nil {
		return nil, err
	}

	if totalSize > maxBytes {
		previewContent, _, _, _ := c.readFileHeadExec(targetPath, 65536)
		return &encoding.FileReadResult{
			Path:           targetPath,
			Name:           name,
			Size:           totalSize,
			Content:        previewContent,
			LineEnding:     encoding.DetectLineEnding([]byte(previewContent)),
			Charset:        string(charset),
			Truncated:      true,
			IsBinary:       encoding.IsBinary([]byte(previewContent)),
			Editable:       false,
			ReadonlyReason: "FILE_TOO_LARGE",
		}, nil
	}

	var stdout bytes.Buffer
	if err := c.DownloadFile(targetPath, &stdout); err != nil {
		return nil, err
	}

	data := stdout.Bytes()
	isBin := encoding.IsBinary(data)
	lineEnding := encoding.DetectLineEnding(data)
	decoded, decErr := encoding.Decode(data, charset)
	if decErr != nil {
		decoded = string(data)
	}

	editable := !isBin
	var readonlyReason string
	if isBin {
		readonlyReason = "BINARY_FILE"
	}

	return &encoding.FileReadResult{
		Path:           targetPath,
		Name:           name,
		Size:           int64(len(data)),
		Content:        decoded,
		LineEnding:     lineEnding,
		Charset:        string(charset),
		Truncated:      false,
		IsBinary:       isBin,
		Editable:       editable,
		ReadonlyReason: readonlyReason,
	}, nil
}

// SaveFile saves content to targetPath safely.
// Normalizes line endings, encodes to target charset, creates backup if requested,
// and performs atomic write to prevent corruption on connection drops.
func (c *Client) SaveFile(targetPath string, content string, targetLineEnding encoding.LineEnding, charset encoding.Charset, createBackup bool) (*encoding.FileSaveResult, error) {
	if targetPath == "" {
		return nil, fmt.Errorf("targetPath cannot be empty")
	}
	if charset == "" {
		charset = encoding.CharsetUTF8
	}

	// 1. Line ending normalization
	normalized := encoding.NormalizeLineEnding(content, targetLineEnding)
	appliedEnding := encoding.DetectLineEnding([]byte(normalized))
	if appliedEnding == encoding.LineEndingNone {
		appliedEnding = targetLineEnding
	}

	// 2. Character encoding
	encodedBytes, err := encoding.Encode(normalized, charset)
	if err != nil {
		return nil, fmt.Errorf("failed to encode content with charset %s: %w", charset, err)
	}

	// Try SFTP first
	sftpClient, err := c.GetSFTPClient()
	if err == nil {
		res, sftpErr := c.saveFileSFTP(sftpClient, targetPath, encodedBytes, appliedEnding, createBackup)
		if sftpErr == nil {
			return res, nil
		}
		c.ResetSFTPClient()
	}

	// Fallback to SSH exec
	return c.saveFileExec(targetPath, encodedBytes, appliedEnding, createBackup)
}

func (c *Client) saveFileSFTP(client *sftp.Client, targetPath string, data []byte, lineEnding encoding.LineEnding, createBackup bool) (*encoding.FileSaveResult, error) {
	var origMode os.FileMode = 0644
	fi, statErr := client.Stat(targetPath)
	if statErr == nil {
		origMode = fi.Mode()
	}

	var backupPath string
	if createBackup && statErr == nil {
		backupPath = fmt.Sprintf("%s.%s.bak", targetPath, time.Now().Format("20060102_150405"))
		if err := copySFTPFile(client, targetPath, backupPath, origMode); err != nil {
			return nil, fmt.Errorf("failed to create backup before saving: %w", err)
		}
	}

	dir := path.Dir(targetPath)
	base := path.Base(targetPath)
	tmpPath := path.Join(dir, fmt.Sprintf(".%s.tmp.%d", base, time.Now().UnixNano()))

	tmpFile, err := client.Create(tmpPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create temp file for saving: %w", err)
	}

	if _, err := tmpFile.Write(data); err != nil {
		tmpFile.Close()
		_ = client.Remove(tmpPath)
		return nil, fmt.Errorf("failed to write temp file: %w", err)
	}
	tmpFile.Close()

	if origMode != 0 {
		_ = client.Chmod(tmpPath, origMode)
	}

	if posixErr := client.PosixRename(tmpPath, targetPath); posixErr != nil {
		if renameErr := client.Rename(tmpPath, targetPath); renameErr != nil {
			_ = client.Remove(targetPath)
			if err := client.Rename(tmpPath, targetPath); err != nil {
				return nil, fmt.Errorf("failed to replace target file: %w", err)
			}
		}
	}

	return &encoding.FileSaveResult{
		Status:     "saved",
		Path:       targetPath,
		BackupPath: backupPath,
		Size:       int64(len(data)),
		LineEnding: lineEnding,
	}, nil
}

func copySFTPFile(client *sftp.Client, src, dst string, mode os.FileMode) error {
	sFile, err := client.Open(src)
	if err != nil {
		return err
	}
	defer sFile.Close()

	dFile, err := client.Create(dst)
	if err != nil {
		return err
	}
	defer dFile.Close()

	if _, err := io.Copy(dFile, sFile); err != nil {
		return err
	}
	if mode != 0 {
		_ = client.Chmod(dst, mode)
	}
	return nil
}

func (c *Client) saveFileExec(targetPath string, data []byte, lineEnding encoding.LineEnding, createBackup bool) (*encoding.FileSaveResult, error) {
	dir := path.Dir(targetPath)
	base := path.Base(targetPath)
	tmpPath := path.Join(dir, fmt.Sprintf(".%s.tmp.%d", base, time.Now().UnixNano()))

	var backupPath string
	if createBackup {
		backupPath = fmt.Sprintf("%s.%s.bak", targetPath, time.Now().Format("20060102_150405"))
	}

	session, err := c.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		return nil, fmt.Errorf("failed to get stdin pipe: %w", err)
	}

	var stderr bytes.Buffer
	session.Stderr = &stderr

	script := fmt.Sprintf("cat > %s", quoteShellArg(tmpPath))
	if err := session.Start(script); err != nil {
		stdin.Close()
		session.Close()
		return nil, fmt.Errorf("failed to start write command: %w", err)
	}

	if _, err := io.Copy(stdin, bytes.NewReader(data)); err != nil {
		stdin.Close()
		session.Close()
		return nil, fmt.Errorf("failed writing data: %w", err)
	}
	stdin.Close()

	if err := session.Wait(); err != nil {
		session.Close()
		return nil, fmt.Errorf("failed writing tmp file: %s", strings.TrimSpace(stderr.String()))
	}
	session.Close()

	backupCmd := ""
	if backupPath != "" {
		backupCmd = fmt.Sprintf(`if [ -e %s ]; then cp -p %s %s 2>/dev/null || cp %s %s; fi && `,
			quoteShellArg(targetPath), quoteShellArg(targetPath), quoteShellArg(backupPath),
			quoteShellArg(targetPath), quoteShellArg(backupPath))
	}

	replaceScript := fmt.Sprintf(`sh -c '%s
if [ -e %s ]; then
  chmod --reference=%s %s 2>/dev/null || true
fi
mv -f %s %s
'`, backupCmd, quoteShellArg(targetPath), quoteShellArg(targetPath), quoteShellArg(tmpPath), quoteShellArg(tmpPath), quoteShellArg(targetPath))

	replaceSession, err := c.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create session for replace: %w", err)
	}
	defer replaceSession.Close()

	var replaceStderr bytes.Buffer
	replaceSession.Stderr = &replaceStderr
	if err := replaceSession.Run(replaceScript); err != nil {
		return nil, fmt.Errorf("failed to move temp file into place: %s", strings.TrimSpace(replaceStderr.String()))
	}

	return &encoding.FileSaveResult{
		Status:     "saved",
		Path:       targetPath,
		BackupPath: backupPath,
		Size:       int64(len(data)),
		LineEnding: lineEnding,
	}, nil
}


