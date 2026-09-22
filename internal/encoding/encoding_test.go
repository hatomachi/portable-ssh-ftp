package encoding

import (
	"testing"
)

func TestDetectLineEnding(t *testing.T) {
	tests := []struct {
		name     string
		input    []byte
		expected LineEnding
	}{
		{"Empty", []byte(""), LineEndingNone},
		{"No newline", []byte("hello world"), LineEndingNone},
		{"LF only", []byte("hello\nworld\n"), LineEndingLF},
		{"CRLF only", []byte("hello\r\nworld\r\n"), LineEndingCRLF},
		{"CR only", []byte("hello\rworld\r"), LineEndingCR},
		{"Mixed LF and CRLF", []byte("hello\r\nworld\n"), LineEndingMixed},
		{"Mixed CRLF and CR", []byte("hello\r\nworld\r"), LineEndingMixed},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := DetectLineEnding(tt.input)
			if got != tt.expected {
				t.Errorf("DetectLineEnding() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestNormalizeLineEnding(t *testing.T) {
	mixed := "line1\r\nline2\nline3\rline4"

	lfNormalized := NormalizeLineEnding(mixed, LineEndingLF)
	expectedLF := "line1\nline2\nline3\nline4"
	if lfNormalized != expectedLF {
		t.Errorf("NormalizeLineEnding(LF) = %q, want %q", lfNormalized, expectedLF)
	}

	crlfNormalized := NormalizeLineEnding(mixed, LineEndingCRLF)
	expectedCRLF := "line1\r\nline2\r\nline3\r\nline4"
	if crlfNormalized != expectedCRLF {
		t.Errorf("NormalizeLineEnding(CRLF) = %q, want %q", crlfNormalized, expectedCRLF)
	}

	preserve := NormalizeLineEnding(mixed, LineEndingPreserve)
	if preserve != mixed {
		t.Errorf("NormalizeLineEnding(preserve) = %q, want %q", preserve, mixed)
	}
}

func TestIsBinary(t *testing.T) {
	text := []byte("Hello, world! This is a plain text file with UTF-8 chars: こんにちは")
	if IsBinary(text) {
		t.Errorf("IsBinary(text) = true, want false")
	}

	bin := []byte("Some header\x00with null byte")
	if !IsBinary(bin) {
		t.Errorf("IsBinary(bin) = false, want true")
	}
}
