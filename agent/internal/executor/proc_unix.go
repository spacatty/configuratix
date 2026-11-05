//go:build linux || darwin

package executor

import (
	"os"
	"os/exec"
	"syscall"
)

// fileOwner returns the uid/gid of an existing file.
func fileOwner(fi os.FileInfo) (int, int, bool) {
	if st, ok := fi.Sys().(*syscall.Stat_t); ok {
		return int(st.Uid), int(st.Gid), true
	}
	return 0, 0, false
}

// setProcessGroup puts the command in its own process group and makes context
// cancellation kill the whole group (so `bash -c 'a | b'` children die too).
func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		// Negative pid = process group.
		if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL); err != nil {
			return cmd.Process.Kill()
		}
		return nil
	}
}
