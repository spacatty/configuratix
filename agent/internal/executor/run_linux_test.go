//go:build linux

package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func runJSON(t *testing.T, ctx context.Context, payload string) (*Result, string, error) {
	t.Helper()
	var buf bytes.Buffer
	res, err := New().Run(ctx, "test", "run", json.RawMessage(payload), &buf)
	return res, buf.String(), err
}

func TestRunCaptureIfRetries(t *testing.T) {
	dir := t.TempDir()
	marker := filepath.Join(dir, "count")
	p := map[string]interface{}{
		"vars": map[string]string{"dir": dir},
		"steps": []map[string]interface{}{
			{"id": "who", "action": "exec", "command": "echo '  hello world  '", "capture": "greet"},
			{"action": "exec", "command": "test {{q:greet}} = 'hello world'"},
			{"action": "exec", "if": "false", "command": "exit 1"},
			// fails twice, then succeeds
			{"action": "exec", "retries": 3, "retry_delay": 1,
				"command": "n=$(cat " + marker + " 2>/dev/null || echo 0); n=$((n+1)); echo $n > " + marker + "; [ $n -ge 3 ]"},
			{"action": "exec", "command": "exit 3", "continue_on_error": true},
			{"action": "script", "script": "x=1\necho \"script $x\""},
		},
	}
	b, _ := json.Marshal(p)
	res, logs, err := runJSON(t, context.Background(), string(b))
	if err != nil {
		t.Fatalf("run failed: %v\n%s", err, logs)
	}
	want := []string{StepOK, StepOK, StepSkipped, StepOK, StepFailed, StepOK}
	for i, w := range want {
		if res.Steps[i].Status != w {
			t.Errorf("step %d status %s, want %s", i, res.Steps[i].Status, w)
		}
	}
	if res.Steps[3].Attempts != 3 {
		t.Errorf("retries: attempts=%d want 3", res.Steps[3].Attempts)
	}
	if res.Steps[4].ExitCode != 3 || !res.Steps[4].ContinuedOnError {
		t.Errorf("continue_on_error step: %+v", res.Steps[4])
	}
	if !strings.Contains(logs, "script 1") {
		t.Errorf("script output missing: %s", logs)
	}
}

func TestRunRollbackDeletesNewFilesAndRestores(t *testing.T) {
	dir := t.TempDir()
	existing := filepath.Join(dir, "existing.conf")
	os.WriteFile(existing, []byte("original"), 0640)
	created := filepath.Join(dir, "new.conf")
	flag := filepath.Join(dir, "rollback-ran")

	p := map[string]interface{}{
		"on_error": "rollback",
		"steps": []map[string]interface{}{
			{"action": "file", "path": existing, "content": "changed"},
			{"action": "file", "path": existing, "content": "changed twice"},
			{"action": "file", "path": created, "content": "new"},
			{"action": "exec", "command": "exit 1"},
		},
		"rollback_steps": []map[string]interface{}{
			{"action": "exec", "command": "touch " + flag},
		},
	}
	b, _ := json.Marshal(p)
	res, logs, err := runJSON(t, context.Background(), string(b))
	if err == nil {
		t.Fatalf("expected failure")
	}
	if !res.RolledBack {
		t.Errorf("rolled_back not set")
	}
	if data, _ := os.ReadFile(existing); string(data) != "original" {
		t.Errorf("existing file = %q, want original\n%s", data, logs)
	}
	if fi, _ := os.Stat(existing); fi.Mode().Perm() != 0640 {
		t.Errorf("mode not preserved: %v", fi.Mode().Perm())
	}
	if _, err := os.Stat(created); !os.IsNotExist(err) {
		t.Errorf("new file not removed by rollback")
	}
	if _, err := os.Stat(flag); err != nil {
		t.Errorf("rollback_steps did not run")
	}
}

func TestFileValidateRestores(t *testing.T) {
	dir := t.TempDir()
	f := filepath.Join(dir, "a.conf")
	os.WriteFile(f, []byte("good"), 0644)
	p := map[string]interface{}{
		"steps": []map[string]interface{}{
			{"action": "file", "path": f, "content": "bad", "validate": "grep -q good {{q:path}}"},
		},
	}
	b, _ := json.Marshal(p)
	_, logs, err := runJSON(t, context.Background(), string(b))
	if err == nil {
		t.Fatalf("expected validation failure\n%s", logs)
	}
	if data, _ := os.ReadFile(f); string(data) != "good" {
		t.Errorf("file not restored after failed validate: %q", data)
	}
}

func TestRunCancelKillsProcessGroup(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	go func() { time.Sleep(300 * time.Millisecond); cancel() }()
	start := time.Now()
	_, _, err := runJSON(t, ctx, `{"steps":[{"action":"exec","command":"sleep 30 | cat"}]}`)
	if err == nil || time.Since(start) > 5*time.Second {
		t.Fatalf("cancel did not stop the step quickly: err=%v after %s", err, time.Since(start))
	}
}

func TestLegacyOnErrorContinue(t *testing.T) {
	_, logs, err := runJSON(t, context.Background(), `{"on_error":"continue","steps":[{"action":"exec","command":"exit 2"},{"action":"exec","command":"echo after"}]}`)
	if err != nil {
		t.Fatalf("on_error=continue must succeed: %v", err)
	}
	for _, s := range []string{"=== Step 1: exec ===", "$ exit 2", "ERROR: exit status 2", "after", "=== All steps completed ==="} {
		if !strings.Contains(logs, s) {
			t.Errorf("logs missing %q:\n%s", s, logs)
		}
	}
}
