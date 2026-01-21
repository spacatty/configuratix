-- Add UFW rules JSON column to machines
ALTER TABLE machines ADD COLUMN IF NOT EXISTS ufw_rules_json JSONB DEFAULT '[]';

