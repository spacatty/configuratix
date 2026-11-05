//go:build windows

package executor

import (
	"os"
	"os/exec"
)

func fileOwner(fi os.FileInfo) (int, int, bool) { return 0, 0, false }

// setProcessGroup is a no-op on Windows (the agent targets Linux).
func setProcessGroup(cmd *exec.Cmd) {}
