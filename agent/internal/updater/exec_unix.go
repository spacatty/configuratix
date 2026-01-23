//go:build linux || darwin
// +build linux darwin

package updater

import (
	"syscall"
)

// execSyscall replaces the current process with a new one
func execSyscall(argv0 string, argv []string, envv []string) error {
	return syscall.Exec(argv0, argv, envv)
}

