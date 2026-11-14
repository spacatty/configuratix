-- 044: pending jobs may carry a deadline. A job that no agent claimed before pending_expires_at
-- is failed by the reaper instead of waiting forever (used for cleanup on a machine that may be
-- offline, e.g. removing a domain from its old machine during a migration). Idempotent.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pending_expires_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_jobs_pending_expiry ON jobs (pending_expires_at)
    WHERE status = 'pending' AND pending_expires_at IS NOT NULL;

-- Removal jobs queued by older builds have no deadline and sit pending forever when their
-- machine is gone. Give them one so the reaper fails them right after this build starts.
-- (Migrations re-run on every boot; the WHERE keeps this a no-op afterwards.)
UPDATE jobs SET pending_expires_at = GREATEST(created_at + INTERVAL '60 seconds', NOW() + INTERVAL '20 seconds')
WHERE status = 'pending' AND action = 'remove_domain' AND pending_expires_at IS NULL;
