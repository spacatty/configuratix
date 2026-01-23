-- Add group support to passthrough pools
-- Groups are resolved dynamically - adding machines to a group auto-includes them in pools

-- Add group_ids to record passthrough pools
ALTER TABLE dns_passthrough_pools ADD COLUMN IF NOT EXISTS group_ids UUID[] DEFAULT '{}';

-- Add group_ids to wildcard pools
ALTER TABLE dns_wildcard_pools ADD COLUMN IF NOT EXISTS group_ids UUID[] DEFAULT '{}';

-- Index for group lookups
CREATE INDEX IF NOT EXISTS idx_passthrough_pools_groups ON dns_passthrough_pools USING GIN(group_ids);
CREATE INDEX IF NOT EXISTS idx_wildcard_pools_groups ON dns_wildcard_pools USING GIN(group_ids);

