package executor

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"time"
)

const defaultStepTimeout = 300 // seconds, same as v1

// tailBuffer keeps the last max bytes written to it.
type tailBuffer struct {
	mu  sync.Mutex
	max int
	buf []byte
}

func newTail(max int) *tailBuffer { return &tailBuffer{max: max} }

func (t *tailBuffer) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, p...)
	if len(t.buf) > t.max {
		t.buf = append([]byte(nil), t.buf[len(t.buf)-t.max:]...)
	}
	return len(p), nil
}

func (t *tailBuffer) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return string(t.buf)
}

// lockedWriter serialises concurrent writes from stdout/stderr copiers.
type lockedWriter struct {
	mu sync.Mutex
	w  io.Writer
}

func (l *lockedWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Write(p)
}

// limitedBuffer is a bytes.Buffer that silently stops growing at max bytes.
type limitedBuffer struct {
	bytes.Buffer
	max int
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if room := b.max - b.Len(); room > 0 {
		if len(p) > room {
			b.Buffer.Write(p[:room])
		} else {
			b.Buffer.Write(p)
		}
	}
	return len(p), nil
}

type shellResult struct {
	ExitCode int
	Stdout   string // only collected when captureStdout is set
	TimedOut bool
}

// runProcess runs argv with a timeout. Combined output is streamed to out;
// stdout is additionally collected when captureStdout is true. Errors mirror
// v1: *exec.ExitError ("exit status N") or "command timed out after Ns".
func runProcess(ctx context.Context, argv []string, env map[string]string, timeoutSec int, out io.Writer, captureStdout bool) (shellResult, error) {
	if timeoutSec <= 0 {
		timeoutSec = defaultStepTimeout
	}
	cctx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSec)*time.Second)
	defer cancel()

	cmd := exec.CommandContext(cctx, argv[0], argv[1:]...)
	setProcessGroup(cmd)
	// Don't hang forever on daemonised grandchildren holding the pipes open.
	cmd.WaitDelay = 10 * time.Second
	if len(env) > 0 {
		cmd.Env = os.Environ()
		keys := make([]string, 0, len(env))
		for k := range env {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			cmd.Env = append(cmd.Env, k+"="+env[k])
		}
	}

	combined := &lockedWriter{w: out}
	var stdout *limitedBuffer
	if captureStdout {
		stdout = &limitedBuffer{max: 1 << 20}
		cmd.Stdout = io.MultiWriter(combined, stdout)
	} else {
		cmd.Stdout = combined
	}
	cmd.Stderr = combined

	err := cmd.Run()
	res := shellResult{ExitCode: -1}
	if cmd.ProcessState != nil {
		res.ExitCode = cmd.ProcessState.ExitCode()
	}
	if stdout != nil {
		res.Stdout = stdout.String()
	}

	if errors.Is(err, exec.ErrWaitDelay) {
		// Process exited; only its inherited pipes stayed open. Judge by exit code.
		if res.ExitCode == 0 {
			err = nil
		} else {
			err = fmt.Errorf("exit status %d", res.ExitCode)
		}
	}

	if ctx.Err() != nil {
		// Whole job cancelled / timed out (reported by the caller).
		return res, ctx.Err()
	}
	if cctx.Err() == context.DeadlineExceeded {
		res.TimedOut = true
		return res, fmt.Errorf("command timed out after %ds", timeoutSec)
	}
	return res, err
}

// execWithTimeout keeps the v1 helper semantics ("$ cmd\n" + combined output).
func execWithTimeout(cmdStr string, timeoutSec int) (string, error) {
	var logs strings.Builder
	logs.WriteString("$ " + cmdStr + "\n")
	_, err := runProcess(context.Background(), []string{"/bin/bash", "-c", cmdStr}, nil, timeoutSec, &logs, false)
	return logs.String(), err
}
