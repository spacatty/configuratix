package executor

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"
)

// Step represents a single operation in a run job. See agent/COMMANDS.md.
type Step struct {
	// v1 fields
	Action  string `json:"action"` // exec, file, service, fetch, script, assert, nginx_test, list
	Command string `json:"command"`
	Timeout int    `json:"timeout"` // seconds, default 300
	Path    string `json:"path"`
	Content string `json:"content"`
	URL     string `json:"url"`
	Mode    string `json:"mode"`
	Op      string `json:"op"`   // file: write, append, delete, backup; service: start, stop, restart, reload, ...
	Name    string `json:"name"` // service name for service steps; display label otherwise
	Log     string `json:"log"`

	// v2 fields
	ID              string            `json:"id,omitempty"`
	Title           string            `json:"title,omitempty"`
	If              string            `json:"if,omitempty"`
	Capture         string            `json:"capture,omitempty"`
	ContinueOnError bool              `json:"continue_on_error,omitempty"`
	Retries         int               `json:"retries,omitempty"`
	RetryDelay      int               `json:"retry_delay,omitempty"` // seconds, default 5
	Env             map[string]string `json:"env,omitempty"`
	Script          string            `json:"script,omitempty"`
	Validate        string            `json:"validate,omitempty"`
	Message         string            `json:"message,omitempty"`
	EscapeVars      bool              `json:"escape_vars,omitempty"`
	Recursive       bool              `json:"recursive,omitempty"`
	Hash            *bool             `json:"hash,omitempty"`
}

// RunPayload is the unified job type for complex operations
type RunPayload struct {
	Steps         []Step            `json:"steps"`
	OnError       string            `json:"on_error"` // stop (default), continue, rollback
	Vars          map[string]string `json:"vars"`
	RollbackSteps []Step            `json:"rollback_steps,omitempty"`
	Timeout       int               `json:"timeout,omitempty"` // whole job, seconds (enforced by the worker)
}

const maxRetries = 10

type runCtx struct {
	ctx context.Context
	txn *fileTxn
}

func (s Step) displayName() string {
	switch {
	case s.Title != "":
		return s.Title
	case s.Name != "" && s.Action == "service":
		return "service " + s.Name
	case s.Name != "":
		return s.Name
	case s.ID != "":
		return s.ID
	}
	return s.Action
}

func capTail(s string, n int) string {
	if len(s) > n {
		return s[len(s)-n:]
	}
	return s
}

// executeRun processes a run job with multiple steps.
func (e *Executor) executeRun(ctx context.Context, payload RunPayload, logs io.Writer, res *Result) error {
	onError := payload.OnError
	if onError == "" {
		onError = "stop"
	}
	vars := make(map[string]string, len(payload.Vars))
	for k, v := range payload.Vars {
		vars[k] = v
	}
	rc := &runCtx{ctx: ctx, txn: newFileTxn()}

	abort := func(err error) error {
		fmt.Fprintf(logs, "ABORTED: %v\n", err)
		if onError == "rollback" {
			e.doRollback(payload, vars, rc, logs, res)
		}
		return err
	}

	for i, raw := range payload.Steps {
		if err := ctx.Err(); err != nil {
			return abort(err)
		}
		header := raw.Action
		if raw.Title != "" || raw.ID != "" {
			header += " (" + raw.displayName() + ")"
		}
		fmt.Fprintf(logs, "\n=== Step %d: %s ===\n", i+1, header)

		// Variable substitution (captured vars from earlier steps included)
		step := substituteVars(raw, vars)
		sr := StepResult{Index: i, ID: step.ID, Name: step.displayName(), Action: step.Action, ExitCode: -1}
		start := time.Now()

		if step.If != "" {
			fmt.Fprintf(logs, "Condition: $ %s\n", step.If)
			_, err := runProcess(ctx, []string{"/bin/bash", "-c", step.If}, step.Env, condTimeout(step.Timeout), logs, false)
			if ctx.Err() != nil {
				return abort(ctx.Err())
			}
			if err != nil {
				fmt.Fprintf(logs, "Skipped (condition not met: %v)\n", err)
				sr.Status = StepSkipped
				sr.DurationMs = time.Since(start).Milliseconds()
				res.Steps = append(res.Steps, sr)
				continue
			}
		}

		tail := newTail(4096)
		w := io.MultiWriter(logs, tail)
		retries := step.Retries
		if retries < 0 {
			retries = 0
		}
		if retries > maxRetries {
			retries = maxRetries
		}
		delay := step.RetryDelay
		if delay <= 0 {
			delay = 5
		}

		var (
			out     stepOutput
			stepErr error
		)
		for attempt := 0; attempt <= retries; attempt++ {
			if attempt > 0 {
				fmt.Fprintf(logs, "Retrying in %ds (attempt %d/%d)...\n", delay, attempt+1, retries+1)
				select {
				case <-ctx.Done():
				case <-time.After(time.Duration(delay) * time.Second):
				}
				if ctx.Err() != nil {
					break
				}
			}
			sr.Attempts = attempt + 1
			out, stepErr = rc.runStepHdr(step, w, logs)
			if stepErr == nil || ctx.Err() != nil {
				break
			}
		}

		// Handle custom logging
		if step.Log != "" && step.Log != "out" && ctx.Err() == nil {
			fmt.Fprintf(logs, "\n--- Log output ---\n")
			logOutput, logErr := execWithTimeout(step.Log, 30)
			fmt.Fprint(logs, logOutput)
			if logErr != nil {
				fmt.Fprintf(logs, "(log command failed: %v)\n", logErr)
			}
		}

		sr.ExitCode = out.exitCode
		sr.Data = out.data
		sr.OutputTail = tail.String()
		sr.DurationMs = time.Since(start).Milliseconds()

		if stepErr == nil {
			sr.Status = StepOK
			if step.Capture != "" {
				vars[step.Capture] = strings.TrimSpace(out.stdout)
				fmt.Fprintf(logs, "Captured %s (%d bytes)\n", step.Capture, len(vars[step.Capture]))
			}
			res.Steps = append(res.Steps, sr)
			continue
		}

		sr.Status = StepFailed
		sr.Error = stepErr.Error()
		fmt.Fprintf(logs, "ERROR: %v\n", stepErr)

		if ctx.Err() != nil {
			res.Steps = append(res.Steps, sr)
			return abort(ctx.Err())
		}
		if step.ContinueOnError {
			sr.ContinuedOnError = true
			res.Steps = append(res.Steps, sr)
			fmt.Fprintf(logs, "(continue_on_error: continuing)\n")
			continue
		}
		res.Steps = append(res.Steps, sr)

		if onError == "rollback" {
			e.doRollback(payload, vars, rc, logs, res)
		}
		if onError != "continue" {
			return stepErr
		}
	}

	fmt.Fprintf(logs, "\n=== All steps completed ===\n")
	return nil
}

func condTimeout(t int) int {
	if t > 0 && t < 60 {
		return t
	}
	return 60
}

func (e *Executor) doRollback(payload RunPayload, vars map[string]string, rc *runCtx, logs io.Writer, res *Result) {
	var rb strings.Builder
	w := io.MultiWriter(logs, &rb)
	fmt.Fprintf(logs, "\n=== Rolling back ===\n")
	fmt.Fprint(w, rc.txn.rollback())

	if len(payload.RollbackSteps) > 0 {
		// Rollback runs even when the job was cancelled / timed out.
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		rrc := &runCtx{ctx: ctx, txn: nil}
		for j, raw := range payload.RollbackSteps {
			s := substituteVars(raw, vars)
			fmt.Fprintf(w, "--- Rollback step %d: %s ---\n", j+1, s.displayName())
			if s.If != "" {
				if _, err := runProcess(ctx, []string{"/bin/bash", "-c", s.If}, s.Env, condTimeout(s.Timeout), w, false); err != nil {
					fmt.Fprintf(w, "Skipped (condition not met)\n")
					continue
				}
			}
			if _, err := rrc.runStep(s, w); err != nil {
				fmt.Fprintf(w, "Rollback step failed: %v\n", err)
			}
		}
	}
	res.RolledBack = true
	res.RollbackLog = capTail(rb.String(), 16*1024)
}

type stepOutput struct {
	exitCode int
	stdout   string // value used by `capture`
	data     json.RawMessage
}

func (rc *runCtx) runStep(step Step, w io.Writer) (stepOutput, error) {
	return rc.runStepHdr(step, w, w)
}

// runStepHdr writes command echo lines ("$ cmd") to hdr only, so result output_tail
// holds process output instead of (possibly long) scripts.
func (rc *runCtx) runStepHdr(step Step, w, hdr io.Writer) (stepOutput, error) {
	out := stepOutput{exitCode: -1}
	switch step.Action {
	case "exec":
		fmt.Fprintf(hdr, "$ %s\n", step.Command)
		r, err := runProcess(rc.ctx, []string{"/bin/bash", "-c", step.Command}, step.Env, step.Timeout, w, step.Capture != "")
		out.exitCode, out.stdout = r.ExitCode, r.Stdout
		return out, err

	case "script":
		lines := strings.Count(step.Script, "\n") + 1
		fmt.Fprintf(hdr, "$ bash script (%d lines, set -euo pipefail)\n", lines)
		r, err := runProcess(rc.ctx, []string{"/bin/bash", "-c", "set -euo pipefail\n" + step.Script}, step.Env, step.Timeout, w, step.Capture != "")
		out.exitCode, out.stdout = r.ExitCode, r.Stdout
		return out, err

	case "assert":
		fmt.Fprintf(hdr, "$ %s\n", step.Command)
		r, err := runProcess(rc.ctx, []string{"/bin/bash", "-c", step.Command}, step.Env, step.Timeout, w, step.Capture != "")
		out.exitCode, out.stdout = r.ExitCode, r.Stdout
		if err != nil && rc.ctx.Err() == nil {
			msg := step.Message
			if msg == "" {
				msg = "assertion failed: " + step.Command
			}
			return out, fmt.Errorf("%s (%v)", msg, err)
		}
		return out, err

	case "nginx_test":
		fmt.Fprintf(hdr, "$ nginx -t\n")
		var combined limitedBuffer
		combined.max = 64 * 1024
		r, err := runProcess(rc.ctx, []string{"nginx", "-t"}, step.Env, step.Timeout, io.MultiWriter(w, &combined), false)
		out.exitCode = r.ExitCode
		out.stdout = combined.String()
		out.data, _ = json.Marshal(map[string]interface{}{"ok": err == nil, "output": combined.String()})
		if err != nil && rc.ctx.Err() == nil {
			return out, fmt.Errorf("nginx config test failed: %v", err)
		}
		return out, err

	case "file":
		return out, rc.fileOp(step, w)

	case "service":
		o, err := serviceOp(rc.ctx, step.Name, step.Op)
		fmt.Fprint(w, o)
		return out, err

	case "fetch":
		return out, rc.fetchToFile(step, w)

	case "list":
		hash := step.Hash == nil || *step.Hash
		lr, err := listFiles(step.Path, step.Recursive, hash)
		if err != nil {
			return out, err
		}
		data, _ := json.Marshal(lr)
		fmt.Fprintf(w, "Listed %d entries under %s\n", len(lr.Entries), lr.Pattern)
		out.data = data
		out.stdout = string(data)
		out.exitCode = 0
		return out, nil

	default:
		return out, fmt.Errorf("unknown action: %s", step.Action)
	}
}
