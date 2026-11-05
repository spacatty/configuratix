-- 040: agent runtime (job claiming, streaming results, cancellation, self-update tracking)
-- Every statement is idempotent: migrations are re-applied on every start.
-- Columns that 039 (jobs owner) may also add use ADD COLUMN IF NOT EXISTS, so
-- the order of 039/040 doesn't matter.

-- Deterministic job ordering: jobs created in one transaction share created_at.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'jobs' AND column_name = 'seq'
    ) THEN
        ALTER TABLE jobs ADD COLUMN seq BIGSERIAL;
    END IF;
END $$;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS result_json JSONB;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS timeout_seconds INT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT FALSE;

-- Claim query: WHERE agent_id = $1 AND status = 'pending' ORDER BY created_at, seq
CREATE INDEX IF NOT EXISTS idx_jobs_agent_pending ON jobs (agent_id, created_at, seq) WHERE status = 'pending';
-- Reaper: running jobs
CREATE INDEX IF NOT EXISTS idx_jobs_running ON jobs (started_at) WHERE status = 'running';

-- Agent runtime state (agents table holds version/last_seen).
ALTER TABLE agents ADD COLUMN IF NOT EXISTS capabilities JSONB;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS arch TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS running_job_id UUID;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS update_state TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS update_target_version TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS update_started_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS update_job_id UUID;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_update_error TEXT;
