// Package jobhooks updates entity state (domains, passthrough members, php runtimes, ...)
// when an agent job reaches a terminal status (completed, failed, cancelled).
//
// Call OnJobFinished(ctx, db, jobID) after the job row has been updated to its terminal status
// (and logs/result_json have been written). Calling it more than once is harmless: the first
// call claims the job via jobs.hooks_processed_at. A background sweeper (StartSweeper) also
// processes any terminal job whose hooks have not run, so entity state converges even when a
// caller forgets to invoke the hook (or the server restarts mid-way).
package jobhooks

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"strings"
	"time"
	"unicode/utf8"

	"configuratix/backend/internal/database"
	"configuratix/backend/internal/models"
)

// Result is the parsed outcome of CONFIGURATIX_* marker lines in job logs.
type Result struct {
	Status    string   `json:"status,omitempty"` // applied | removed | rolled_back | failed
	Reason    string   `json:"reason,omitempty"`
	Disabled  []string `json:"disabled,omitempty"`  // configs disabled because of missing certificates
	Reenabled []string `json:"reenabled,omitempty"` // previously disabled configs re-enabled
}

// ParseResult extracts CONFIGURATIX_RESULT / CONFIGURATIX_DISABLED / CONFIGURATIX_REENABLED markers.
// The last CONFIGURATIX_RESULT line wins.
func ParseResult(logs string) Result {
	var r Result
	for _, line := range strings.Split(logs, "\n") {
		line = strings.TrimSpace(line)
		// Skip echoed commands ("$ ... echo 'CONFIGURATIX_RESULT|..'") – markers start the line.
		switch {
		case strings.HasPrefix(line, "CONFIGURATIX_RESULT|"):
			parts := strings.SplitN(line, "|", 3)
			r.Status = parts[1]
			r.Reason = ""
			if len(parts) == 3 {
				r.Reason = strings.TrimSpace(parts[2])
			}
		case strings.HasPrefix(line, "CONFIGURATIX_DISABLED|"):
			parts := strings.SplitN(line, "|", 3)
			if len(parts) >= 2 {
				r.Disabled = append(r.Disabled, parts[1])
			}
		case strings.HasPrefix(line, "CONFIGURATIX_REENABLED|"):
			parts := strings.SplitN(line, "|", 2)
			if len(parts) == 2 {
				r.Reenabled = append(r.Reenabled, parts[1])
			}
		}
	}
	return r
}

// ErrorMessage derives a short human error for a failed job from its logs.
func ErrorMessage(status, logs string, res Result) string {
	if status == models.JobStatusCancelled {
		return "Cancelled"
	}
	if res.Reason != "" {
		if res.Status == "rolled_back" {
			return "Rolled back: " + res.Reason
		}
		return res.Reason
	}
	lines := strings.Split(logs, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		l := strings.TrimSpace(lines[i])
		if strings.HasPrefix(l, "ERROR:") || strings.Contains(l, "[emerg]") {
			return truncate(strings.TrimSpace(strings.TrimPrefix(l, "ERROR:")), 500)
		}
	}
	for i := len(lines) - 1; i >= 0; i-- {
		l := strings.TrimSpace(lines[i])
		if l != "" && !strings.HasPrefix(l, "===") {
			return truncate(l, 500)
		}
	}
	return "Job failed"
}

type jobRow struct {
	ID           string          `db:"id"`
	Status       string          `db:"status"`
	Action       sql.NullString  `db:"action"`
	EntityType   sql.NullString  `db:"entity_type"`
	EntityID     sql.NullString  `db:"entity_id"`
	Logs         sql.NullString  `db:"logs"`
	ErrorMessage sql.NullString  `db:"error_message"`
	Payload      json.RawMessage `db:"payload_json"`
}

// OnJobStarted marks linked entities as in-progress (domain apply_status applying/removing).
// Optional: call when an agent reports a job as running.
func OnJobStarted(ctx context.Context, db *database.DB, jobID string) {
	defer recoverLog("OnJobStarted", jobID)
	var j jobRow
	if err := db.GetContext(ctx, &j, `SELECT id, COALESCE(status, '') AS status, action, entity_type, entity_id, NULL::text AS logs,
		NULL::text AS error_message, COALESCE(payload_json, '{}'::jsonb) AS payload_json FROM jobs WHERE id = $1`, jobID); err != nil {
		return
	}
	if j.EntityType.String != "domain" || !j.EntityID.Valid {
		return
	}
	state := "applying"
	if j.Action.String == "remove_domain" {
		state = "removing"
	}
	_, _ = db.ExecContext(ctx, `UPDATE domains SET apply_status = $1
		WHERE id::text = $2 AND last_job_id::text = $3 AND apply_status IN ('pending', 'applying', 'removing')`,
		state, j.EntityID.String, jobID)
}

// OnJobFinished applies the job outcome to the entity it belongs to. Never panics.
func OnJobFinished(ctx context.Context, db *database.DB, jobID string) {
	defer recoverLog("OnJobFinished", jobID)

	// Claim the job so concurrent callers (agent handler + sweeper) process it once.
	var claimed string
	err := db.GetContext(ctx, &claimed, `
		UPDATE jobs SET hooks_processed_at = NOW()
		WHERE id = $1 AND hooks_processed_at IS NULL AND status IN ('completed', 'failed', 'cancelled')
		RETURNING id`, jobID)
	if err != nil {
		return // not terminal, already processed or not found
	}

	var j jobRow
	if err := db.GetContext(ctx, &j, `SELECT id, COALESCE(status, '') AS status, action, entity_type, entity_id, logs, error_message, COALESCE(payload_json, '{}'::jsonb) AS payload_json
		FROM jobs WHERE id = $1`, jobID); err != nil {
		log.Printf("jobhooks: load job %s: %v", jobID, err)
		return
	}

	logs := j.Logs.String
	res := ParseResult(logs)
	success := j.Status == models.JobStatusCompleted
	errMsg := ""
	if !success {
		errMsg = j.ErrorMessage.String
		if errMsg == "" {
			errMsg = ErrorMessage(j.Status, logs, res)
		}
	}

	// Persist error message and parsed apply result (merged, never overwriting agent data).
	if !success && !j.ErrorMessage.Valid {
		_, _ = db.ExecContext(ctx, `UPDATE jobs SET error_message = $1 WHERE id = $2 AND error_message IS NULL`, errMsg, jobID)
	}
	if res.Status != "" || len(res.Disabled) > 0 || len(res.Reenabled) > 0 {
		if b, err := json.Marshal(res); err == nil {
			_, _ = db.ExecContext(ctx, `
				UPDATE jobs SET result_json = COALESCE(result_json, '{}'::jsonb) || jsonb_build_object('apply', $1::jsonb)
				WHERE id = $2 AND (result_json IS NULL OR jsonb_typeof(result_json) = 'object')`, string(b), jobID)
		}
	}

	vars := payloadVars(j.Payload)
	entityID := j.EntityID.String

	switch j.EntityType.String {
	case "domain":
		handleDomain(ctx, db, j, success, errMsg)
	case "passthrough":
		if entityID != "" {
			// entity_id is the machine id; only mark applied once the agent confirmed success.
			_, _ = db.ExecContext(ctx, `UPDATE dns_passthrough_members SET nginx_config_applied = $1 WHERE machine_id::text = $2`, success, entityID)
			_, _ = db.ExecContext(ctx, `UPDATE dns_wildcard_pool_members SET nginx_config_applied = $1 WHERE machine_id::text = $2`, success, entityID)
		}
	case "php_runtime":
		handlePHP(ctx, db, j.Action.String, entityID, vars["version"], success, errMsg)
	}
}

func handleDomain(ctx context.Context, db *database.DB, j jobRow, success bool, errMsg string) {
	if !j.EntityID.Valid {
		return
	}
	switch j.Action.String {
	case "remove_domain":
		if success {
			_, _ = db.ExecContext(ctx, `UPDATE domains SET apply_status = NULL, last_apply_error = NULL, updated_at = NOW()
				WHERE id::text = $1 AND last_job_id = $2`, j.EntityID.String, j.ID)
		} else {
			_, _ = db.ExecContext(ctx, `UPDATE domains SET apply_status = 'failed', last_apply_error = $3, updated_at = NOW()
				WHERE id::text = $1 AND last_job_id = $2`, j.EntityID.String, j.ID, "Remove failed: "+errMsg)
		}
	case "deploy_landing":
		if !success {
			_, _ = db.ExecContext(ctx, `UPDATE domains SET last_apply_error = $2, updated_at = NOW() WHERE id::text = $1`,
				j.EntityID.String, "Landing deploy failed: "+errMsg)
		}
	default: // apply_domain, apply_passthrough_domain, apply_nginx_config
		if success {
			_, _ = db.ExecContext(ctx, `UPDATE domains SET apply_status = 'applied', last_apply_error = NULL,
					last_applied_at = NOW(),
					status = CASE WHEN status = 'idle' AND assigned_machine_id IS NOT NULL THEN 'linked' ELSE status END,
					updated_at = NOW()
				WHERE id::text = $1 AND (last_job_id = $2 OR last_job_id IS NULL)`, j.EntityID.String, j.ID)
		} else {
			_, _ = db.ExecContext(ctx, `UPDATE domains SET apply_status = 'failed', last_apply_error = $3, updated_at = NOW()
				WHERE id::text = $1 AND (last_job_id = $2 OR last_job_id IS NULL)`, j.EntityID.String, j.ID, errMsg)
		}
	}
}

func handlePHP(ctx context.Context, db *database.DB, action, machineID, version string, success bool, errMsg string) {
	if machineID == "" {
		return
	}
	switch action {
	case "install_php_runtime", "sync_php_extensions":
		if success {
			_, _ = db.ExecContext(ctx, `UPDATE php_runtimes
				SET status = 'installed', socket_path = COALESCE(NULLIF($2, ''), socket_path), installed_at = NOW(),
					error_message = NULL, updated_at = NOW()
				WHERE machine_id::text = $1`, machineID, socketPath(version))
		} else {
			_, _ = db.ExecContext(ctx, `UPDATE php_runtimes SET status = 'failed', error_message = $2, updated_at = NOW()
				WHERE machine_id::text = $1`, machineID, truncate(errMsg, 1000))
		}
	case "remove_php_runtime":
		_, _ = db.ExecContext(ctx, `DELETE FROM php_runtimes WHERE machine_id::text = $1 AND status = 'removing'`, machineID)
	}
}

func socketPath(version string) string {
	if version == "" {
		return ""
	}
	return models.GetPHPSocketPath(version)
}

func payloadVars(payload json.RawMessage) map[string]string {
	var p struct {
		Vars map[string]string `json:"vars"`
	}
	_ = json.Unmarshal(payload, &p)
	if p.Vars == nil {
		p.Vars = map[string]string{}
	}
	return p.Vars
}

// StartSweeper runs OnJobFinished for terminal jobs whose hooks have not run yet (e.g. jobs
// failed by the timeout reaper or finished while the server restarted). Runs until ctx is done.
func StartSweeper(ctx context.Context, db *database.DB) {
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			sweep(ctx, db)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

func sweep(ctx context.Context, db *database.DB) {
	defer recoverLog("sweep", "")
	var ids []string
	if err := db.SelectContext(ctx, &ids, `
		SELECT id::text FROM jobs
		WHERE hooks_processed_at IS NULL AND status IN ('completed', 'failed', 'cancelled')
		ORDER BY finished_at NULLS FIRST LIMIT 200`); err != nil {
		return
	}
	for _, id := range ids {
		OnJobFinished(ctx, db, id)
	}
}

func recoverLog(where, jobID string) {
	if r := recover(); r != nil {
		log.Printf("jobhooks: panic in %s (job %s): %v", where, jobID, r)
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	s = s[:n]
	for len(s) > 0 && !utf8.ValidString(s) {
		s = s[:len(s)-1]
	}
	return s
}
