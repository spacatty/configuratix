-- 041: health check details and optional custom health check path. Idempotent.
ALTER TABLE domains ADD COLUMN IF NOT EXISTS health_check_path TEXT;            -- NULL = "/"
ALTER TABLE domains ADD COLUMN IF NOT EXISTS last_check_status_code INT;        -- NULL = no HTTP response
ALTER TABLE domains ADD COLUMN IF NOT EXISTS last_check_response_ms INT;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS last_check_error TEXT;
