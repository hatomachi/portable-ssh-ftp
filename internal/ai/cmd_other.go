//go:build !windows

package ai

import "os/exec"

func hideConsoleWindow(cmd *exec.Cmd) {
	// No-op on non-Windows platforms (macOS, Linux)
}
