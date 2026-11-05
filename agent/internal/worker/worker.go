// Package worker runs jobs one at a time in a dedicated goroutine so that
// heartbeats are never blocked by long jobs. Logs are streamed to the backend
// while the job runs; cancellation and timeouts kill the running step.
package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"configuratix/agent/internal/client"
	"configuratix/agent/internal/executor"
	"configuratix/agent/internal/state"
)

const (
	pollInterval     = 5 * time.Second
	flushInterval    = 1500 * time.Millisecond
	idleReportEvery  = 5 * time.Second // progress ping (cancel check) without new logs
	maxChunk         = 256 * 1024
	maxLegacyLogSize = 4 << 20
)

type Worker struct {
	c    *client.Client
	exec *executor.Executor
}

func New(c *client.Client, e *executor.Executor) *Worker {
	return &Worker{c: c, exec: e}
}

// Run polls for jobs forever, executing them sequentially (preserves order).
func (w *Worker) Run() {
	for {
		jobs, err := w.c.ClaimJobs(1)
		if err != nil {
			log.Printf("Failed to get jobs: %v", err)
			time.Sleep(pollInterval)
			continue
		}
		if len(jobs) == 0 {
			time.Sleep(pollInterval)
			continue
		}
		for _, job := range jobs {
			w.runJob(job)
		}
	}
}

// streamer buffers job output and ships it to the backend periodically.
type streamer struct {
	mu       sync.Mutex
	pending  bytes.Buffer
	full     bytes.Buffer // kept for legacy backends that ignore append_logs
	fullCut  bool
	legacy   bool // backend doesn't understand append_logs
	cancel   context.CancelFunc
	canceled bool
	c        *client.Client
	jobID    string
	stop     chan struct{}
	done     chan struct{}
}

func (s *streamer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pending.Write(p)
	if !s.fullCut {
		if s.full.Len()+len(p) > maxLegacyLogSize {
			s.fullCut = true
			s.full.WriteString("\n... (log truncated) ...\n")
		} else {
			s.full.Write(p)
		}
	}
	return len(p), nil
}

func (s *streamer) takeChunk() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := s.pending.Len()
	if n > maxChunk {
		n = maxChunk
	}
	chunk := string(s.pending.Next(n))
	if s.pending.Len() == 0 {
		s.pending.Reset()
	}
	return chunk
}

func (s *streamer) unshift(chunk string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rest := s.pending.String()
	s.pending.Reset()
	s.pending.WriteString(chunk)
	s.pending.WriteString(rest)
}

func (s *streamer) handleResp(r *client.JobUpdateResponse) {
	if r == nil {
		return
	}
	s.mu.Lock()
	if r.JobStatus == "" {
		s.legacy = true
	}
	trigger := r.CancelRequested && !s.canceled
	if trigger {
		s.canceled = true
	}
	s.mu.Unlock()
	if trigger {
		log.Printf("Job %s: cancellation requested by server", s.jobID)
		fmt.Fprintf(s, "\n*** Cancellation requested, stopping ***\n")
		s.cancel()
	}
}

func (s *streamer) isLegacy() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.legacy
}

func (s *streamer) loop() {
	defer close(s.done)
	t := time.NewTicker(flushInterval)
	defer t.Stop()
	lastReport := time.Now()
	for {
		select {
		case <-s.stop:
			return
		case <-t.C:
		}
		if s.isLegacy() {
			continue // legacy backend: everything is sent at the end
		}
		chunk := s.takeChunk()
		if chunk == "" && time.Since(lastReport) < idleReportEvery {
			continue
		}
		upd := client.JobUpdate{JobID: s.jobID, Status: "running", AppendLogs: &chunk}
		resp, err := s.c.ReportJob(upd)
		if err != nil {
			s.unshift(chunk) // retry next tick
			continue
		}
		lastReport = time.Now()
		s.handleResp(resp)
	}
}

func payloadTimeout(raw json.RawMessage) int {
	var p struct {
		Timeout int `json:"timeout"`
	}
	_ = json.Unmarshal(raw, &p)
	return p.Timeout
}

func (w *Worker) runJob(job client.Job) {
	log.Printf("Processing job %s (type: %s)", job.ID, job.Type)
	state.SetRunningJob(job.ID)
	defer state.SetRunningJob("")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	timeout := payloadTimeout(job.Payload)
	if timeout <= 0 && job.TimeoutSeconds != nil {
		timeout = *job.TimeoutSeconds
	}
	if job.Type == "update_agent" {
		timeout = 0 // the update manages its own timeouts; never kill mid-install
	}
	runCtx := ctx
	if timeout > 0 {
		var tcancel context.CancelFunc
		runCtx, tcancel = context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
		defer tcancel()
	}

	s := &streamer{c: w.c, jobID: job.ID, cancel: cancel, stop: make(chan struct{}), done: make(chan struct{})}

	// First report: mirrors v1 "Starting job execution..." and tells us whether
	// the backend speaks v2 (job_status present in the response).
	start := "Starting job execution...\n"
	if resp, err := w.c.ReportJob(client.JobUpdate{JobID: job.ID, Status: "running", AppendLogs: &start}); err == nil {
		s.handleResp(resp)
	} else {
		log.Printf("Job %s: initial status report failed: %v", job.ID, err)
	}
	go s.loop()

	jobCtx := runCtx
	if job.Type == "update_agent" {
		jobCtx = context.Background() // not cancellable once started
	}
	res, err := w.exec.Run(jobCtx, job.ID, job.Type, job.Payload, s)

	close(s.stop)
	<-s.done

	status := "completed"
	if err != nil {
		status = "failed"
		switch {
		case s.canceled && errors.Is(err, context.Canceled):
			status = "cancelled"
			err = errors.New("cancelled by user")
		case errors.Is(err, context.DeadlineExceeded) || errors.Is(runCtx.Err(), context.DeadlineExceeded):
			err = fmt.Errorf("job timed out after %ds", timeout)
		}
		res.Error = err.Error()
		fmt.Fprintf(s, "\nError: %s", err.Error())
		log.Printf("Job %s %s: %v", job.ID, status, err)
	} else {
		log.Printf("Job %s completed", job.ID)
	}
	res.Status = status

	final := client.JobUpdate{JobID: job.ID, Status: status, Result: res}
	if err != nil {
		final.Error = err.Error()
	}
	if s.isLegacy() {
		s.mu.Lock()
		final.Logs = s.full.String()
		s.mu.Unlock()
	} else {
		rest := s.takeChunk()
		for more := s.takeChunk(); more != ""; more = s.takeChunk() {
			rest += more
		}
		final.AppendLogs = &rest
	}

	// The final report matters (it unblocks dependent state on the server):
	// retry for ~2 minutes.
	backoff := time.Second
	for attempt := 1; ; attempt++ {
		if _, rerr := w.c.ReportJob(final); rerr == nil {
			break
		} else if attempt >= 8 {
			log.Printf("Job %s: giving up reporting final status: %v", job.ID, rerr)
			break
		} else {
			log.Printf("Job %s: final report failed (attempt %d): %v", job.ID, attempt, rerr)
		}
		time.Sleep(backoff)
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}

	if res.After != nil {
		res.After()
	}
}
