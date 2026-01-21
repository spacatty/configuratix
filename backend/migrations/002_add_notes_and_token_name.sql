-- Add notes_md to domains for registration info, expiry dates, etc.
ALTER TABLE domains ADD COLUMN IF NOT EXISTS notes_md TEXT;

-- Add name to enrollment_tokens for identification
ALTER TABLE enrollment_tokens ADD COLUMN IF NOT EXISTS name VARCHAR(255);

