package handlers

import (
	"context"
	"log"
	"time"

	"configuratix/backend/internal/database"
	"configuratix/backend/internal/jobhooks"

	"github.com/google/uuid"
)

const (
	defaultJobTimeoutSeconds = 900
	// reaperGrace lets the agent report its own timeout before the server does.
	reaperGrace    = 60 * time.Second
	reaperInterval = 60 * time.Second
)

// StartAgentJobReaper periodically:
//   - fails `running` jobs whose started_at + COALESCE(timeout_seconds, 900s)
//     (+ grace) has passed, unless the agent's heartbeat still reports that job
//     as running (and the agent was seen in the last 10 minutes);
//   - fails agent updates that were not confirmed within 5 minutes.
//
// Pending jobs are left alone.
func StartAgentJobReaper(db *database.DB) {
	go func() {
		t := time.NewTicker(reaperInterval)
		defer t.Stop()
		for {
			reapOnce(db)
			<-t.C
		}
	}()
}

func reapOnce(db *database.DB) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("Job reaper panic: %v", r)
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	reapStaleAgentUpdates(ctx, db)

	var ids []uuid.UUID
	err := db.SelectContext(ctx, &ids, `
		UPDATE jobs j SET
			status = 'failed',
			error_message = 'timed out',
			finished_at = NOW(),
			updated_at = NOW(),
			logs = COALESCE(j.logs, '') || E'\n[server] Job timed out: no result within ' ||
				COALESCE(NULLIF(j.timeout_seconds, 0), $1)::text || E's\n'
		FROM agents a
		WHERE j.agent_id = a.id
		AND j.status = 'running'
		AND COALESCE(j.started_at, j.claimed_at, j.updated_at)
			+ make_interval(secs => COALESCE(NULLIF(j.timeout_seconds, 0), $1) + $2) < NOW()
		AND (a.running_job_id IS DISTINCT FROM j.id
			OR a.last_seen IS NULL OR a.last_seen < NOW() - INTERVAL '10 minutes')
		AND NOT (j.type = 'update_agent' AND a.update_job_id = j.id
			AND a.update_state IN `+updateInProgressSQL+`)
		RETURNING j.id
	`, defaultJobTimeoutSeconds, int(reaperGrace.Seconds()))
	if err != nil {
		log.Printf("Job reaper: %v", err)
		return
	}
	if len(ids) == 0 {
		return
	}
	log.Printf("Job reaper: marked %d running job(s) as timed out", len(ids))
	h := &AgentHandler{db: db}
	for _, id := range ids {
		db.ExecContext(ctx, `UPDATE agents SET running_job_id = NULL WHERE running_job_id = $1`, id)
		h.updateL7CertificateStatuses(id, "failed", "timed out")
		jobhooks.OnJobFinished(context.Background(), db, id.String())
	}
}
