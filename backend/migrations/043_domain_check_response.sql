-- 043: keep what the last failed health check got back, for debugging. Idempotent.
-- Cleared when a check passes; served by GET /domains/{id}/check-response, not the list.
ALTER TABLE domains ADD COLUMN IF NOT EXISTS last_check_response_headers TEXT;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS last_check_response_body TEXT;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS last_check_body_truncated BOOLEAN NOT NULL DEFAULT false;
