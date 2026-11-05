-- 042: reusable health check presets, plus per-domain custom rules. Idempotent.
-- A domain uses its preset's rules when health_check_preset_id is set, otherwise its own columns.
CREATE TABLE IF NOT EXISTS health_check_presets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    path            TEXT NOT NULL DEFAULT '/',
    expected_status TEXT NOT NULL DEFAULT '200',   -- e.g. "200", "200,301-302", "2xx"
    body_contains   TEXT,                          -- NULL = don't inspect the body
    timeout_seconds INT NOT NULL DEFAULT 15,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE domains ADD COLUMN IF NOT EXISTS health_check_preset_id UUID REFERENCES health_check_presets(id) ON DELETE SET NULL;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS health_check_expected TEXT;          -- status spec; NULL = health_check_expected_status
ALTER TABLE domains ADD COLUMN IF NOT EXISTS health_check_body_contains TEXT;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS health_check_timeout_seconds INT;    -- NULL = 15

CREATE INDEX IF NOT EXISTS idx_domains_health_check_preset ON domains(health_check_preset_id);
