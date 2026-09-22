//go:build windows

package ai

import (
	"os/exec"
	"testing"
)

func TestHideConsoleWindow_Windows(t *testing.T) {
	cmd := exec.Command("cmd.exe", "/c", "echo", "test")
	hideConsoleWindow(cmd)

	if cmd.SysProcAttr == nil {
		t.Fatal("expected SysProcAttr to be non-nil on Windows")
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Errorf("expected HideWindow to be true, got %v", cmd.SysProcAttr.HideWindow)
	}
	if cmd.SysProcAttr.CreationFlags&createNoWindow == 0 {
		t.Errorf("expected CreationFlags to have CREATE_NO_WINDOW (0x%08x), got 0x%08x", createNoWindow, cmd.SysProcAttr.CreationFlags)
	}
}
