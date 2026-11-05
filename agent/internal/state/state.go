// Package state holds process-wide runtime state that is reported to the
// backend in every heartbeat (running job, update progress, ...).
package state

import (
	"sync"
	"time"
)

// Update states reported in heartbeats (agents.update_state on the backend).
const (
	UpdateIdle        = ""
	UpdateDownloading = "downloading"
	UpdateVerifying   = "verifying"
	UpdateInstalling  = "installing"
	UpdateRestarting  = "restarting"
	UpdateConfirmed   = "confirmed"
	UpdateRolledBack  = "rolled_back"
	UpdateFailed      = "failed"
)

type Snapshot struct {
	RunningJobID        string
	UpdateState         string
	UpdateTargetVersion string
	UpdateError         string
	UpdateJobID         string
	UpdateChangedAt     time.Time
}

var (
	mu    sync.Mutex
	cur   Snapshot
	kickC = make(chan struct{}, 1)
)

// Get returns a copy of the current state.
func Get() Snapshot {
	mu.Lock()
	defer mu.Unlock()
	return cur
}

// SetRunningJob records the job currently executed by the worker ("" = idle).
func SetRunningJob(id string) {
	mu.Lock()
	cur.RunningJobID = id
	mu.Unlock()
	Kick()
}

// SetUpdate records an update state transition and requests an early heartbeat.
func SetUpdate(st, target, errMsg string) {
	mu.Lock()
	cur.UpdateState = st
	if target != "" {
		cur.UpdateTargetVersion = target
	}
	cur.UpdateError = errMsg
	cur.UpdateChangedAt = time.Now()
	mu.Unlock()
	Kick()
}

// SetUpdateJob records the update_agent job the current update belongs to.
func SetUpdateJob(id string) {
	mu.Lock()
	cur.UpdateJobID = id
	mu.Unlock()
}

// ClearUpdateIfTerminal resets a terminal update state (confirmed, failed,
// rolled_back) once it has been reported, so a stale outcome is never
// attributed to a later update.
func ClearUpdateIfTerminal(reported time.Time) {
	mu.Lock()
	defer mu.Unlock()
	switch cur.UpdateState {
	case UpdateConfirmed, UpdateFailed, UpdateRolledBack:
		if !cur.UpdateChangedAt.After(reported) {
			cur.UpdateState = UpdateIdle
			cur.UpdateError = ""
			cur.UpdateJobID = ""
		}
	}
}

// Kick asks the heartbeat loop to send a heartbeat soon (non-blocking).
func Kick() {
	select {
	case kickC <- struct{}{}:
	default:
	}
}

// KickChan is consumed by the heartbeat loop.
func KickChan() <-chan struct{} { return kickC }
