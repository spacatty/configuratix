//go:build windows
// +build windows

package updater

import (
	"errors"
	"os/exec"
)

// execSyscall is not used on Windows (we use exec.Command instead)
func execSyscall(argv0 string, argv []string, envv []string) error {
	return errors.New("exec not supported on Windows, use restart instead")
}

func detach(cmd *exec.Cmd) {}
