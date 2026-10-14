-- Fast agent API key lookup.
-- API keys are 256-bit random values, so a SHA-256 digest is a safe indexed lookup key.
-- Previously every agent request bcrypt-compared the key against every agent (O(N) bcrypt per request).
-- Existing agents are backfilled lazily on their first successful bcrypt match.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS api_key_lookup VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_api_key_lookup ON agents (api_key_lookup) WHERE api_key_lookup IS NOT NULL;
