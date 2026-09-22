package encoding

import (
	"bytes"
	"io"
	"strings"

	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/transform"
)

type Charset string

const (
	CharsetUTF8     Charset = "UTF-8"
	CharsetShiftJIS Charset = "Shift-JIS"
	CharsetEUCJP    Charset = "EUC-JP"
	CharsetAuto     Charset = "Auto"
)

// Decode decodes bytes from the given charset to a UTF-8 string.
func Decode(data []byte, charset Charset) (string, error) {
	if len(data) == 0 {
		return "", nil
	}

	switch normalizeCharset(charset) {
	case CharsetShiftJIS:
		reader := transform.NewReader(bytes.NewReader(data), japanese.ShiftJIS.NewDecoder())
		decoded, err := io.ReadAll(reader)
		if err != nil {
			return string(data), err
		}
		return string(decoded), nil
	case CharsetEUCJP:
		reader := transform.NewReader(bytes.NewReader(data), japanese.EUCJP.NewDecoder())
		decoded, err := io.ReadAll(reader)
		if err != nil {
			return string(data), err
		}
		return string(decoded), nil
	default:
		// Default to UTF-8
		return string(data), nil
	}
}

// Encode encodes a UTF-8 string to bytes of the target charset.
func Encode(str string, charset Charset) ([]byte, error) {
	if str == "" {
		return []byte{}, nil
	}

	switch normalizeCharset(charset) {
	case CharsetShiftJIS:
		var buf bytes.Buffer
		writer := transform.NewWriter(&buf, japanese.ShiftJIS.NewEncoder())
		_, err := writer.Write([]byte(str))
		if err != nil {
			return []byte(str), err
		}
		_ = writer.Close()
		return buf.Bytes(), nil
	case CharsetEUCJP:
		var buf bytes.Buffer
		writer := transform.NewWriter(&buf, japanese.EUCJP.NewEncoder())
		_, err := writer.Write([]byte(str))
		if err != nil {
			return []byte(str), err
		}
		_ = writer.Close()
		return buf.Bytes(), nil
	default:
		// Default to UTF-8
		return []byte(str), nil
	}
}

func normalizeCharset(c Charset) Charset {
	upper := strings.ToUpper(strings.TrimSpace(string(c)))
	switch upper {
	case "SJIS", "SHIFT_JIS", "SHIFT-JIS", "CP932", "WINDOWS-31J":
		return CharsetShiftJIS
	case "EUC", "EUCJP", "EUC-JP":
		return CharsetEUCJP
	default:
		return CharsetUTF8
	}
}

type LineEnding string

const (
	LineEndingLF       LineEnding = "LF"
	LineEndingCRLF     LineEnding = "CRLF"
	LineEndingCR       LineEnding = "CR"
	LineEndingMixed    LineEnding = "Mixed"
	LineEndingNone     LineEnding = "None"
	LineEndingPreserve LineEnding = "preserve"
)

// MaxEditableFileSize defines the maximum file size (2MB) allowed for full editing.
const MaxEditableFileSize int64 = 2 * 1024 * 1024

// FileReadResult represents the result of reading a remote file for preview or editing.
type FileReadResult struct {
	Path           string     `json:"path"`
	Name           string     `json:"name"`
	Size           int64      `json:"size"`
	Content        string     `json:"content"`
	LineEnding     LineEnding `json:"lineEnding"`
	Charset        string     `json:"charset"`
	Truncated      bool       `json:"truncated"`
	IsBinary       bool       `json:"isBinary"`
	Editable       bool       `json:"editable"`
	ReadonlyReason string     `json:"readonlyReason,omitempty"`
}

// FileSaveResult represents the response after saving a file.
type FileSaveResult struct {
	Status     string     `json:"status"`
	Path       string     `json:"path"`
	BackupPath string     `json:"backupPath,omitempty"`
	Size       int64      `json:"size"`
	LineEnding LineEnding `json:"lineEnding"`
}


// DetectLineEnding detects the line ending style from raw bytes.
func DetectLineEnding(data []byte) LineEnding {
	var crlfCount, lfCount, crCount int

	for i := 0; i < len(data); i++ {
		if data[i] == '\r' {
			if i+1 < len(data) && data[i+1] == '\n' {
				crlfCount++
				i++ // skip '\n'
			} else {
				crCount++
			}
		} else if data[i] == '\n' {
			lfCount++
		}
	}

	total := crlfCount + lfCount + crCount
	if total == 0 {
		return LineEndingNone
	}

	if crlfCount > 0 && lfCount == 0 && crCount == 0 {
		return LineEndingCRLF
	}
	if lfCount > 0 && crlfCount == 0 && crCount == 0 {
		return LineEndingLF
	}
	if crCount > 0 && crlfCount == 0 && lfCount == 0 {
		return LineEndingCR
	}

	return LineEndingMixed
}

// NormalizeLineEnding converts all line endings in content to target style.
func NormalizeLineEnding(content string, target LineEnding) string {
	switch target {
	case LineEndingLF:
		// Convert \r\n -> \n, and remaining \r -> \n
		normalized := strings.ReplaceAll(content, "\r\n", "\n")
		return strings.ReplaceAll(normalized, "\r", "\n")
	case LineEndingCRLF:
		// Convert \r\n -> \n, \r -> \n, then \n -> \r\n
		normalized := strings.ReplaceAll(content, "\r\n", "\n")
		normalized = strings.ReplaceAll(normalized, "\r", "\n")
		return strings.ReplaceAll(normalized, "\n", "\r\n")
	case LineEndingCR:
		// Convert all to \r
		normalized := strings.ReplaceAll(content, "\r\n", "\r")
		return strings.ReplaceAll(normalized, "\n", "\r")
	default:
		return content
	}
}

// IsBinary checks if data appears to be binary by inspecting for NUL bytes in the first 1024 bytes.
func IsBinary(data []byte) bool {
	limit := len(data)
	if limit > 1024 {
		limit = 1024
	}
	return bytes.IndexByte(data[:limit], 0) != -1
}

