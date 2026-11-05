package executor

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const backupSuffix = ".configuratix-backup"

// fileTxn tracks file changes of one run job so rollback can undo them:
// existing files are backed up once (first touch), files that did not exist
// before are recorded and deleted on rollback.
type fileTxn struct {
	backups []backupEntry
	created []string
	touched map[string]bool
}

type backupEntry struct {
	backupPath string
	origPath   string
	mode       os.FileMode
}

func newFileTxn() *fileTxn { return &fileTxn{touched: map[string]bool{}} }

// prepare must be called before modifying path. It records a backup of the
// current content (or that the file is new). Only the first touch counts so
// rollback restores the state from before the job.
func (t *fileTxn) prepare(path string, logs io.Writer) error {
	if t == nil || t.touched[path] {
		return nil
	}
	t.touched[path] = true
	fi, err := os.Stat(path)
	if os.IsNotExist(err) {
		t.created = append(t.created, path)
		return nil
	}
	if err != nil {
		return err
	}
	if fi.IsDir() {
		return fmt.Errorf("%s is a directory", path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	backupPath := path + backupSuffix
	if err := os.WriteFile(backupPath, data, 0600); err != nil {
		return fmt.Errorf("backup %s: %v", path, err)
	}
	t.backups = append(t.backups, backupEntry{backupPath: backupPath, origPath: path, mode: fi.Mode().Perm()})
	fmt.Fprintf(logs, "Backed up to %s\n", backupPath)
	return nil
}

// restoreOne undoes changes to a single path (used by validate failures).
func (t *fileTxn) restoreOne(path string) string {
	var logs strings.Builder
	for i := len(t.backups) - 1; i >= 0; i-- {
		b := t.backups[i]
		if b.origPath != path {
			continue
		}
		if data, err := os.ReadFile(b.backupPath); err == nil {
			if err := atomicWriteFile(b.origPath, data, b.mode, true); err != nil {
				fmt.Fprintf(&logs, "Failed to restore %s: %v\n", b.origPath, err)
			} else {
				fmt.Fprintf(&logs, "Restored %s\n", b.origPath)
			}
		}
		return logs.String()
	}
	for _, c := range t.created {
		if c == path {
			if err := os.Remove(path); err == nil {
				fmt.Fprintf(&logs, "Removed new file %s\n", path)
			}
		}
	}
	return logs.String()
}

// rollback restores backups (newest first) and removes files created by the job.
func (t *fileTxn) rollback() string {
	var logs strings.Builder
	if t == nil {
		return ""
	}
	for i := len(t.backups) - 1; i >= 0; i-- {
		b := t.backups[i]
		data, err := os.ReadFile(b.backupPath)
		if err != nil {
			continue
		}
		if err := atomicWriteFile(b.origPath, data, b.mode, true); err != nil {
			fmt.Fprintf(&logs, "Failed to restore %s: %v\n", b.origPath, err)
			continue
		}
		os.Remove(b.backupPath)
		fmt.Fprintf(&logs, "Restored %s\n", b.origPath)
	}
	for i := len(t.created) - 1; i >= 0; i-- {
		p := t.created[i]
		if err := os.Remove(p); err == nil {
			fmt.Fprintf(&logs, "Removed new file %s\n", p)
		} else if !os.IsNotExist(err) {
			fmt.Fprintf(&logs, "Failed to remove %s: %v\n", p, err)
		}
	}
	return logs.String()
}

func parseMode(mode string, def os.FileMode) os.FileMode {
	if mode != "" {
		if m, err := strconv.ParseUint(mode, 8, 32); err == nil {
			return os.FileMode(m)
		}
	}
	return def
}

// atomicWriteFile writes data to a temp file in the target directory, fsyncs
// it and renames it over path. Symlinks are followed (the link target is
// replaced, like os.WriteFile would). When keepAttrs is set and the file
// exists, its mode/owner are preserved unless perm was given explicitly by
// the caller (perm != 0 and keepAttrs=false).
func atomicWriteFile(path string, data []byte, perm os.FileMode, keepAttrs bool) error {
	target := path
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		target = resolved
	}
	dir := filepath.Dir(target)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	uid, gid, haveOwner := -1, -1, false
	if fi, err := os.Stat(target); err == nil {
		if keepAttrs {
			perm = fi.Mode().Perm()
		}
		uid, gid, haveOwner = fileOwner(fi)
	}
	if perm == 0 {
		perm = 0644
	}

	tmp, err := os.CreateTemp(dir, "."+filepath.Base(target)+".cfx-tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	cleanup := func() { os.Remove(tmpName) }

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		cleanup()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		cleanup()
		return err
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return err
	}
	if err := os.Chmod(tmpName, perm); err != nil {
		cleanup()
		return err
	}
	if haveOwner {
		_ = os.Lchown(tmpName, uid, gid)
	}
	if err := os.Rename(tmpName, target); err != nil {
		cleanup()
		return err
	}
	if d, err := os.Open(dir); err == nil {
		_ = d.Sync()
		d.Close()
	}
	return nil
}

func httpGetBytes(ctx context.Context, url string) ([]byte, int, error) {
	cctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, "GET", url, nil)
	if err != nil {
		return nil, 0, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	return data, resp.StatusCode, err
}

// fileOp performs a file step. txn may be nil (legacy "file" job type).
func (r *runCtx) fileOp(step Step, logs io.Writer) error {
	path := step.Path
	op := step.Op
	if op == "" {
		op = "write"
	}
	if path == "" && op != "backup" {
		return fmt.Errorf("file step requires path")
	}

	content := step.Content
	if step.URL != "" {
		fmt.Fprintf(logs, "Fetching content from %s...\n", step.URL)
		data, _, err := httpGetBytes(r.ctx, step.URL)
		if err != nil {
			return err
		}
		content = string(data)
		fmt.Fprintf(logs, "Fetched %d bytes\n", len(data))
	}

	switch op {
	case "write":
		if err := r.txn.prepare(path, logs); err != nil {
			return err
		}
		fmt.Fprintf(logs, "Writing to %s (%d bytes)...\n", path, len(content))
		explicit := step.Mode != ""
		if err := atomicWriteFile(path, []byte(content), parseMode(step.Mode, 0644), !explicit); err != nil {
			return err
		}
		if step.Validate != "" {
			if err := r.validateFile(step, path, logs); err != nil {
				return err
			}
		}
		fmt.Fprintf(logs, "Done\n")

	case "append":
		if err := r.txn.prepare(path, logs); err != nil {
			return err
		}
		fmt.Fprintf(logs, "Appending to %s...\n", path)
		f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, parseMode(step.Mode, 0644))
		if err != nil {
			return err
		}
		_, werr := f.WriteString(content)
		serr := f.Sync()
		f.Close()
		if werr != nil {
			return werr
		}
		if serr != nil {
			return serr
		}
		if step.Validate != "" {
			if err := r.validateFile(step, path, logs); err != nil {
				return err
			}
		}
		fmt.Fprintf(logs, "Done\n")

	case "delete":
		if _, err := os.Stat(path); err == nil {
			if err := r.txn.prepare(path, logs); err != nil {
				return err
			}
			if r.txn == nil { // legacy: still leave a backup next to the file
				if data, err := os.ReadFile(path); err == nil {
					os.WriteFile(path+backupSuffix, data, 0600)
				}
			}
		}
		fmt.Fprintf(logs, "Deleting %s...\n", path)
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		fmt.Fprintf(logs, "Done\n")

	case "backup":
		backupPath := path + backupSuffix
		fmt.Fprintf(logs, "Backing up %s to %s...\n", path, backupPath)
		if data, err := os.ReadFile(path); err == nil {
			os.WriteFile(backupPath, data, 0600)
			fmt.Fprintf(logs, "Done\n")
		} else {
			fmt.Fprintf(logs, "File not found, skipped\n")
		}

	default:
		return fmt.Errorf("unknown file op: %s", op)
	}
	return nil
}

// validateFile runs step.Validate with {{path}} bound; on failure the file is
// restored to its pre-job state.
func (r *runCtx) validateFile(step Step, path string, logs io.Writer) error {
	vars := map[string]string{"path": path}
	cmd := applyReplacer(buildReplacer(vars, step.EscapeVars), step.Validate)
	fmt.Fprintf(logs, "Validating: $ %s\n", cmd)
	_, err := runProcess(r.ctx, []string{"/bin/bash", "-c", cmd}, step.Env, step.Timeout, logs, false)
	if err != nil {
		fmt.Fprintf(logs, "Validation failed: %v\n", err)
		if r.txn != nil {
			fmt.Fprint(logs, r.txn.restoreOne(path))
		}
		return fmt.Errorf("validation failed for %s: %v", path, err)
	}
	fmt.Fprintf(logs, "Validation passed\n")
	return nil
}

// fetchToFile downloads a URL to a file (atomic, tracked for rollback).
func (r *runCtx) fetchToFile(step Step, logs io.Writer) error {
	fmt.Fprintf(logs, "Fetching %s -> %s\n", step.URL, step.Path)
	data, status, err := httpGetBytes(r.ctx, step.URL)
	if err != nil {
		return err
	}
	if status != 200 {
		return fmt.Errorf("HTTP %d", status)
	}
	if err := r.txn.prepare(step.Path, logs); err != nil {
		return err
	}
	if err := atomicWriteFile(step.Path, data, parseMode(step.Mode, 0644), step.Mode == ""); err != nil {
		return err
	}
	fmt.Fprintf(logs, "Downloaded %d bytes\n", len(data))
	return nil
}
