//go:build windows

package ai

import (
	"os/exec"
	"syscall"
)

// CREATE_NO_WINDOW prevents Windows from creating a new console window for the child process.
const createNoWindow = 0x08000000

func hideConsoleWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags |= createNoWindow
}
