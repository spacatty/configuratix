-- Per-domain expected HTTP status for health checks (default 200)
ALTER TABLE domains ADD COLUMN IF NOT EXISTS health_check_expected_status INTEGER NOT NULL DEFAULT 200;
