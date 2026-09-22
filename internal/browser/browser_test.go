package browser

import (
	"runtime"
	"testing"
)

func TestGetBrowserPaths(t *testing.T) {
	switch runtime.GOOS {
	case "windows":
		paths := getWindowsBrowserPaths()
		if len(paths) == 0 {
			t.Fatal("expected windows browser candidates, got none")
		}
	case "darwin":
		paths := getDarwinBrowserPaths()
		if len(paths) == 0 {
			t.Fatal("expected darwin browser candidates, got none")
		}
	default:
		execs := getLinuxBrowserExecutables()
		if len(execs) == 0 {
			t.Fatal("expected linux browser candidates, got none")
		}
	}
}

func TestResolveExecutable_NotFound(t *testing.T) {
	_, err := resolveExecutable("/non/existent/path/to/browser.exe")
	if err == nil {
		t.Fatal("expected error for non-existent path")
	}
}
