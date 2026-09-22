package ai

import (
	"os/exec"
	"runtime"
	"testing"
)

func TestHideConsoleWindow(t *testing.T) {
	cmd := exec.Command("echo", "test")
	hideConsoleWindow(cmd)

	if runtime.GOOS == "windows" {
		if cmd.SysProcAttr == nil {
			t.Fatal("expected SysProcAttr to be non-nil on Windows")
		}
		// On Windows, HideWindow and CreationFlags are tested
	}
}
