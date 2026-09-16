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
