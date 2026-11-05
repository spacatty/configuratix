package updater

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"configuratix/agent/internal/state"
)

const (
	// StateDir holds the update marker, rollback watchdog scripts and the
	// rolled-back notice.
	StateDir         = "/var/lib/configuratix"
	markerName       = "update-marker.json"
	rolledBackName   = "update-rolled-back.json"
	rollbackDelaySec = 120
	maxBinarySize    = 256 << 20
)

// ServiceUnit is the systemd unit restarted after an update.
func ServiceUnit() string {
	if u := os.Getenv("CONFIGURATIX_AGENT_UNIT"); u != "" {
		return u
	}
	return "configuratix-agent"
}

// Marker is written right after the new binary is installed. Its presence
// after rollbackDelaySec makes the watchdog restore the previous binary.
type Marker struct {
	JobID           string    `json:"job_id,omitempty"`
	TargetVersion   string    `json:"target_version"`
	PreviousVersion string    `json:"previous_version"`
	Binary          string    `json:"binary"`
	PreviousBinary  string    `json:"previous_binary"`
	RollbackUnit    string    `json:"rollback_unit,omitempty"`
	RollbackPID     int       `json:"rollback_pid,omitempty"`
	RollbackScript  string    `json:"rollback_script,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

// ApplyInfo is returned as result.data of the update_agent job.
type ApplyInfo struct {
	FromVersion  string `json:"from_version"`
	ToVersion    string `json:"to_version"`
	Arch         string `json:"arch"`
	Checksum     string `json:"checksum,omitempty"`
	Binary       string `json:"binary,omitempty"`
	RollbackUnit string `json:"rollback_unit,omitempty"`
	Restarting   bool   `json:"restarting"`
}

func markerPath() string     { return filepath.Join(StateDir, markerName) }
func rolledBackPath() string { return filepath.Join(StateDir, rolledBackName) }

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// Apply downloads, verifies, self-tests and installs the published agent
// binary, arms the rollback watchdog and returns a func that restarts the
// agent (to be called after the job's final status was reported).
func (u *Updater) Apply(ctx context.Context, jobID, target string, logw io.Writer) (*ApplyInfo, func(), error) {
	arch := runtime.GOARCH
	info := &ApplyInfo{FromVersion: u.currentVersion, ToVersion: target, Arch: arch}
	logf := func(format string, a ...interface{}) { fmt.Fprintf(logw, format+"\n", a...) }
	fail := func(err error) (*ApplyInfo, func(), error) {
		state.SetUpdate(state.UpdateFailed, info.ToVersion, err.Error())
		logf("Update failed: %v", err)
		return info, nil, err
	}

	if runtime.GOOS != "linux" {
		return fail(fmt.Errorf("self-update is only supported on linux"))
	}
	state.SetUpdateJob(jobID)
	state.SetUpdate(state.UpdateDownloading, target, "")
	logf("Agent update triggered (current %s, arch %s)", u.currentVersion, arch)

	exe, err := os.Executable()
	if err != nil {
		return fail(fmt.Errorf("failed to get executable path: %v", err))
	}
	if r, err := filepath.EvalSymlinks(exe); err == nil {
		exe = r
	}
	info.Binary = exe
	dir := filepath.Dir(exe)

	// Published version info (per-arch checksum).
	vi, verr := u.getServerVersion()
	expected := ""
	if verr == nil {
		expected = vi.ChecksumFor(arch)
		if info.ToVersion == "" {
			info.ToVersion = vi.Version
		}
	} else {
		logf("Warning: version endpoint unavailable: %v", verr)
	}

	u.mu.RLock()
	apiKey := u.apiKey
	u.mu.RUnlock()

	dlURL := u.serverURL + "/api/agent/download?arch=" + arch
	logf("Downloading from %s...", dlURL)
	dctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	req, _ := http.NewRequestWithContext(dctx, "GET", dlURL, nil)
	if apiKey != "" {
		req.Header.Set("X-API-Key", apiKey)
	}
	resp, err := (&http.Client{}).Do(req)
	if err != nil {
		return fail(fmt.Errorf("failed to download: %v", err))
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fail(fmt.Errorf("download failed: HTTP %d", resp.StatusCode))
	}
	if ha := resp.Header.Get("X-Agent-Arch"); ha != "" && ha != arch {
		return fail(fmt.Errorf("server sent %s binary, this host is %s", ha, arch))
	}
	if hc := strings.ToLower(strings.TrimSpace(resp.Header.Get("X-Agent-Checksum"))); hc != "" {
		if expected != "" && hc != expected {
			return fail(fmt.Errorf("checksum header %s does not match published checksum %s", hc, expected))
		}
		expected = hc
	}
	if expected == "" {
		return fail(fmt.Errorf("no sha256 checksum published for %s; refusing to install", arch))
	}
	if hv := resp.Header.Get("X-Agent-Version"); hv != "" {
		if info.ToVersion != "" && hv != info.ToVersion {
			return fail(fmt.Errorf("server offers version %s but job targets %s", hv, info.ToVersion))
		}
		info.ToVersion = hv
	}
	if info.ToVersion == "" {
		return fail(fmt.Errorf("target version unknown"))
	}
	state.SetUpdate(state.UpdateDownloading, info.ToVersion, "")
	if info.ToVersion == u.currentVersion {
		logf("Already running version %s, nothing to do", u.currentVersion)
		state.SetUpdate(state.UpdateConfirmed, info.ToVersion, "")
		return info, nil, nil
	}

	tmp, err := os.CreateTemp(dir, ".configuratix-agent.new-*")
	if err != nil {
		return fail(fmt.Errorf("failed to create temp file in %s: %v", dir, err))
	}
	tmpPath := tmp.Name()
	installed := false
	defer func() {
		if !installed {
			os.Remove(tmpPath)
		}
	}()

	hasher := sha256.New()
	n, err := io.Copy(io.MultiWriter(tmp, hasher), io.LimitReader(resp.Body, maxBinarySize+1))
	if err == nil {
		err = tmp.Sync()
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return fail(fmt.Errorf("failed to download binary: %v", err))
	}
	if n > maxBinarySize {
		return fail(fmt.Errorf("binary larger than %d bytes", maxBinarySize))
	}
	logf("Downloaded %d bytes (version %s)", n, info.ToVersion)

	state.SetUpdate(state.UpdateVerifying, info.ToVersion, "")
	actual := hex.EncodeToString(hasher.Sum(nil))
	if actual != expected {
		return fail(fmt.Errorf("checksum mismatch: expected %s, got %s", expected, actual))
	}
	info.Checksum = actual
	logf("Checksum verified (sha256 %s)", actual)

	if err := os.Chmod(tmpPath, 0755); err != nil {
		return fail(fmt.Errorf("failed to chmod: %v", err))
	}

	// Self-test the new binary before touching the installed one.
	stctx, stcancel := context.WithTimeout(ctx, 30*time.Second)
	out, err := exec.CommandContext(stctx, tmpPath, "--self-test").CombinedOutput()
	stcancel()
	logf("Self-test output: %s", strings.TrimSpace(string(out)))
	if err != nil {
		return fail(fmt.Errorf("self-test of new binary failed: %v", err))
	}
	if !strings.Contains(string(out), "version="+info.ToVersion+" ") && !strings.HasSuffix(strings.TrimSpace(string(out)), "version="+info.ToVersion) {
		return fail(fmt.Errorf("self-test reported a different version (want %s)", info.ToVersion))
	}

	state.SetUpdate(state.UpdateInstalling, info.ToVersion, "")
	oldPath := exe + ".old"
	if err := copyFileAtomic(exe, oldPath); err != nil {
		return fail(fmt.Errorf("failed to back up current binary: %v", err))
	}
	logf("Backed up current binary to %s", oldPath)

	if err := os.MkdirAll(StateDir, 0755); err != nil {
		return fail(fmt.Errorf("failed to create %s: %v", StateDir, err))
	}
	m := Marker{
		JobID:           jobID,
		TargetVersion:   info.ToVersion,
		PreviousVersion: u.currentVersion,
		Binary:          exe,
		PreviousBinary:  oldPath,
		CreatedAt:       time.Now().UTC(),
	}
	// Write the marker before swapping so a crash right after the rename is
	// still covered by the watchdog.
	if err := writeMarker(&m); err != nil {
		return fail(fmt.Errorf("failed to write update marker: %v", err))
	}
	if err := os.Rename(tmpPath, exe); err != nil {
		os.Remove(markerPath())
		return fail(fmt.Errorf("failed to install new binary: %v", err))
	}
	installed = true
	logf("Installed %s over %s", info.ToVersion, exe)

	if err := armWatchdog(&m); err != nil {
		// Without a watchdog a broken binary could not be recovered; undo.
		logf("Failed to arm rollback watchdog: %v; restoring previous binary", err)
		if rerr := copyFileAtomic(oldPath, exe); rerr != nil {
			logf("CRITICAL: restore failed: %v", rerr)
		}
		os.Remove(markerPath())
		return fail(fmt.Errorf("failed to arm rollback watchdog: %v", err))
	}
	if err := writeMarker(&m); err != nil {
		logf("Warning: failed to update marker: %v", err)
	}
	if m.RollbackUnit != "" {
		logf("Rollback watchdog armed: %s (fires in %ds unless the new version confirms)", m.RollbackUnit, rollbackDelaySec)
	} else {
		logf("Rollback watchdog armed: pid %d (fires in %ds unless the new version confirms)", m.RollbackPID, rollbackDelaySec)
	}
	info.RollbackUnit = m.RollbackUnit
	info.Restarting = true

	state.SetUpdate(state.UpdateRestarting, info.ToVersion, "")
	logf("Restarting agent to activate %s; the server confirms the update on the first heartbeat", info.ToVersion)
	after := func() {
		time.Sleep(500 * time.Millisecond)
		restartSelf(exe)
	}
	return info, after, nil
}

func writeMarker(m *Marker) error {
	data, _ := json.MarshalIndent(m, "", "  ")
	tmp := markerPath() + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, markerPath())
}

func readMarker() (*Marker, error) {
	data, err := os.ReadFile(markerPath())
	if err != nil {
		return nil, err
	}
	var m Marker
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

func copyFileAtomic(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".tmp"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}

// armWatchdog schedules the rollback script independently of the agent
// process (systemd transient timer; detached sleeper as fallback).
func armWatchdog(m *Marker) error {
	ts := time.Now().Unix()
	script := filepath.Join(StateDir, fmt.Sprintf("rollback-%d.sh", ts))
	rolled, _ := json.Marshal(map[string]string{
		"job_id":           m.JobID,
		"target_version":   m.TargetVersion,
		"previous_version": m.PreviousVersion,
	})
	body := strings.Join([]string{
		"#!/bin/sh",
		"# Configuratix agent update rollback watchdog (generated)",
		"MARKER=" + shellQuote(markerPath()),
		"[ -f \"$MARKER\" ] || exit 0",
		"OLD=" + shellQuote(m.PreviousBinary),
		"EXE=" + shellQuote(m.Binary),
		"if [ -f \"$OLD\" ]; then",
		"  cp -f \"$OLD\" \"$EXE.rollback-tmp\" && chmod 0755 \"$EXE.rollback-tmp\" && mv -f \"$EXE.rollback-tmp\" \"$EXE\"",
		"fi",
		"printf '%s\\n' " + shellQuote(string(rolled)) + " > " + shellQuote(rolledBackPath()),
		"rm -f \"$MARKER\"",
		"systemctl restart " + shellQuote(ServiceUnit()) + " 2>/dev/null || true",
		"rm -f \"$0\"",
		"",
	}, "\n")
	if err := os.WriteFile(script, []byte(body), 0700); err != nil {
		return err
	}
	m.RollbackScript = script

	if p, err := exec.LookPath("systemd-run"); err == nil {
		unit := fmt.Sprintf("configuratix-agent-rollback-%d", ts)
		out, err := exec.Command(p,
			"--unit="+unit,
			fmt.Sprintf("--on-active=%d", rollbackDelaySec),
			"--timer-property=AccuracySec=1s",
			"/bin/sh", script,
		).CombinedOutput()
		if err == nil {
			m.RollbackUnit = unit
			return nil
		}
		log.Printf("systemd-run failed (%v): %s; falling back to detached sleeper", err, bytes.TrimSpace(out))
	}

	cmd := exec.Command("/bin/sh", "-c", fmt.Sprintf("sleep %d; exec /bin/sh %s", rollbackDelaySec, shellQuote(script)))
	devnull, _ := os.OpenFile(os.DevNull, os.O_RDWR, 0)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = devnull, devnull, devnull
	detach(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	m.RollbackPID = cmd.Process.Pid
	cmd.Process.Release()
	return nil
}

func systemdManaged() bool {
	if _, err := os.Stat("/run/systemd/system"); err != nil {
		return false
	}
	_, err := exec.LookPath("systemctl")
	return err == nil
}

// restartSelf restarts the agent: through systemd when available, otherwise
// by re-executing the (new) binary in place.
func restartSelf(exe string) {
	if systemdManaged() && os.Getenv("INVOCATION_ID") != "" {
		if err := exec.Command("systemctl", "--no-block", "restart", ServiceUnit()).Run(); err == nil {
			// systemd will stop us shortly; don't keep working meanwhile.
			time.Sleep(30 * time.Second)
		} else {
			log.Printf("systemctl restart failed: %v; re-executing", err)
		}
	}
	if err := execSyscall(exe, os.Args, os.Environ()); err != nil {
		log.Printf("Failed to exec new binary: %v; exiting so the supervisor restarts us", err)
	}
	os.Exit(1)
}

// --- startup confirmation -------------------------------------------------

var (
	confirmMu        sync.Mutex
	pendingMarker    *Marker
	rolledBackNotice bool
	startupChecked   bool
)

// CheckOnStartup inspects the update marker / rolled-back notice left by a
// previous update so the next heartbeats report the outcome.
func CheckOnStartup(currentVersion string) {
	confirmMu.Lock()
	defer confirmMu.Unlock()
	startupChecked = true

	if data, err := os.ReadFile(rolledBackPath()); err == nil {
		var rb struct {
			JobID         string `json:"job_id"`
			TargetVersion string `json:"target_version"`
		}
		_ = json.Unmarshal(data, &rb)
		msg := fmt.Sprintf("version %s did not confirm within %ds; rolled back to %s", rb.TargetVersion, rollbackDelaySec, currentVersion)
		log.Printf("Agent update rolled back: %s", msg)
		state.SetUpdateJob(rb.JobID)
		state.SetUpdate(state.UpdateRolledBack, rb.TargetVersion, msg)
		rolledBackNotice = true
	}

	m, err := readMarker()
	if err != nil {
		return
	}
	if m.TargetVersion == currentVersion {
		pendingMarker = m
		state.SetUpdateJob(m.JobID)
		state.SetUpdate(state.UpdateRestarting, m.TargetVersion, "")
		log.Printf("Started after update to %s; confirming after first successful heartbeat", currentVersion)
	} else {
		log.Printf("Update marker targets %s but running %s; leaving it to the rollback watchdog", m.TargetVersion, currentVersion)
	}
}

// AfterHeartbeat must be called after every successful heartbeat. On the
// first call after an update it disarms the rollback watchdog.
func AfterHeartbeat() {
	confirmMu.Lock()
	defer confirmMu.Unlock()
	if !startupChecked {
		return
	}
	if rolledBackNotice {
		os.Remove(rolledBackPath())
		rolledBackNotice = false
	}
	m := pendingMarker
	if m == nil {
		return
	}
	pendingMarker = nil
	// Removing the marker is what disarms the watchdog; stopping the unit is
	// just tidiness.
	if err := os.Remove(markerPath()); err != nil && !os.IsNotExist(err) {
		log.Printf("Failed to remove update marker: %v", err)
	}
	if m.RollbackUnit != "" {
		exec.Command("systemctl", "stop", m.RollbackUnit+".timer", m.RollbackUnit+".service").Run()
	}
	if m.RollbackPID > 0 {
		killIfRollbackSleeper(m.RollbackPID)
	}
	if m.RollbackScript != "" {
		os.Remove(m.RollbackScript)
	}
	state.SetUpdate(state.UpdateConfirmed, m.TargetVersion, "")
	log.Printf("Agent update to %s confirmed; rollback watchdog disarmed", m.TargetVersion)
}

func killIfRollbackSleeper(pid int) {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", pid))
	if err != nil || !bytes.Contains(data, []byte("rollback-")) {
		return
	}
	if p, err := os.FindProcess(pid); err == nil {
		p.Kill()
	}
}
