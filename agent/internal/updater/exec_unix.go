//go:build linux || darwin
// +build linux darwin

package updater

import (
	"os/exec"
	"syscall"
)

// execSyscall replaces the current process with a new one
func execSyscall(argv0 string, argv []string, envv []string) error {
	return syscall.Exec(argv0, argv, envv)
}

// detach starts cmd in its own session so it outlives the agent process.
func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
