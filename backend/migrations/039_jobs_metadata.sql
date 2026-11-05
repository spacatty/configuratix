-- Job metadata, entity linkage and apply tracking.
-- Idempotent: the migration runner re-executes every file on each start.

-- ===================== jobs =====================
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS action TEXT;              -- logical action / template id (apply_domain, remove_domain, ...)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS entity_type TEXT;         -- domain|nginx_config|machine|dns_domain|landing|php_runtime|passthrough|command|file|agent
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS entity_id TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS result_json JSONB;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS timeout_seconds INT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS attempts INT DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS parent_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hooks_processed_at TIMESTAMP WITH TIME ZONE;

UPDATE jobs SET attempts = 0 WHERE attempts IS NULL;
UPDATE jobs SET cancel_requested = false WHERE cancel_requested IS NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_agent_created ON jobs (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_entity ON jobs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_jobs_hooks_pending ON jobs (finished_at)
    WHERE hooks_processed_at IS NULL AND status IN ('completed', 'failed', 'cancelled');

-- Historic terminal jobs never need their hooks run.
UPDATE jobs SET hooks_processed_at = COALESCE(finished_at, updated_at, NOW())
WHERE hooks_processed_at IS NULL AND status IN ('completed', 'failed', 'cancelled')
  AND COALESCE(finished_at, updated_at, created_at) < NOW() - INTERVAL '1 hour';

-- Heuristic title backfill for existing jobs (type + vars.domain / first command line).
UPDATE jobs SET title = CASE
    WHEN type = 'deploy_landing' THEN 'Deploy landing'
        || COALESCE(' → ' || NULLIF(payload_json->>'target_path', ''), '')
    WHEN type = 'update_agent' THEN 'Update agent'
    WHEN type = 'run' AND payload_json->'vars'->>'domain' IS NOT NULL AND payload_json->'vars' ? 'nginx_config'
        THEN 'Apply nginx config · ' || (payload_json->'vars'->>'domain')
    WHEN type = 'run' AND payload_json->'vars'->>'domain' IS NOT NULL AND payload_json->'vars' ? 'target'
        THEN 'Apply passthrough · ' || (payload_json->'vars'->>'domain')
    WHEN type = 'run' AND payload_json->'vars'->>'domain' IS NOT NULL
        THEN 'Domain job · ' || (payload_json->'vars'->>'domain')
    WHEN type = 'run' AND payload_json->'vars'->>'version' IS NOT NULL
        THEN 'PHP ' || (payload_json->'vars'->>'version')
    WHEN type = 'run' AND payload_json->'vars'->>'path' IS NOT NULL
        THEN 'File · ' || (payload_json->'vars'->>'path')
    WHEN type = 'run' AND payload_json->'vars' ? 'password' THEN 'Change root password'
    WHEN type = 'run' AND jsonb_typeof(payload_json->'steps') = 'array'
        THEN 'Run · ' || LEFT(REGEXP_REPLACE(TRIM(COALESCE(payload_json->'steps'->0->>'command', payload_json->'steps'->0->>'action', 'command')), '\s+', ' ', 'g'), 60)
    ELSE INITCAP(REPLACE(type, '_', ' '))
END
WHERE title IS NULL;

-- ===================== domains =====================
ALTER TABLE domains ADD COLUMN IF NOT EXISTS apply_status TEXT;      -- NULL|pending|applying|applied|failed|removing
ALTER TABLE domains ADD COLUMN IF NOT EXISTS last_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS last_apply_error TEXT;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS last_applied_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_domains_apply_status ON domains (apply_status);
CREATE INDEX IF NOT EXISTS idx_domain_config_links_config ON domain_config_links (nginx_config_id);

-- Existing assigned domains: assume their config was applied when the domain row was last updated.
UPDATE domains d SET apply_status = 'applied', last_applied_at = d.updated_at
WHERE d.apply_status IS NULL AND d.last_applied_at IS NULL AND d.last_job_id IS NULL
  AND d.assigned_machine_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM domain_config_links l WHERE l.domain_id = d.id);
