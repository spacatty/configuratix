-- DNS Passthrough Pools for Dynamic Record Rotation
-- This enables automatic DNS record rotation between a pool of proxy servers

-- Add proxy_mode to dns_managed_domains
ALTER TABLE dns_managed_domains ADD COLUMN IF NOT EXISTS proxy_mode VARCHAR(20) DEFAULT 'static';
-- 'static' = direct DNS management (default)
-- 'separate' = dynamic passthrough with per-record pools
-- 'wildcard' = dynamic passthrough with single *.domain pool

-- Add mode to dns_records for per-record static/dynamic
ALTER TABLE dns_records ADD COLUMN IF NOT EXISTS mode VARCHAR(20) DEFAULT 'static';
-- 'static' = manual record management (current behavior)
-- 'dynamic' = automated rotation through machine pool

-- Passthrough pools for individual records (one per dynamic record)
CREATE TABLE IF NOT EXISTS dns_passthrough_pools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dns_record_id UUID NOT NULL REFERENCES dns_records(id) ON DELETE CASCADE,
    target_ip VARCHAR(255) NOT NULL,
    target_port INTEGER DEFAULT 443,
    rotation_strategy VARCHAR(20) DEFAULT 'round_robin', -- 'round_robin', 'random'
    rotation_mode VARCHAR(20) DEFAULT 'interval',        -- 'interval', 'scheduled'
    interval_minutes INTEGER DEFAULT 60,
    scheduled_times JSONB DEFAULT '[]',                  -- ['00:00', '06:00', '12:00', '18:00']
    health_check_enabled BOOLEAN DEFAULT true,
    current_machine_id UUID REFERENCES machines(id) ON DELETE SET NULL,
    current_index INTEGER DEFAULT 0,
    is_paused BOOLEAN DEFAULT false,
    last_rotated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(dns_record_id)
);

-- Pool members for record pools (machines that can serve as proxy)
CREATE TABLE IF NOT EXISTS dns_passthrough_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id UUID NOT NULL REFERENCES dns_passthrough_pools(id) ON DELETE CASCADE,
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    priority INTEGER DEFAULT 0,               -- For ordering in round-robin
    is_enabled BOOLEAN DEFAULT true,
    nginx_config_applied BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(pool_id, machine_id)
);

-- Wildcard pools (one per domain in wildcard mode)
CREATE TABLE IF NOT EXISTS dns_wildcard_pools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dns_domain_id UUID NOT NULL REFERENCES dns_managed_domains(id) ON DELETE CASCADE,
    include_root BOOLEAN DEFAULT true,        -- Include @ record in passthrough
    target_ip VARCHAR(255) NOT NULL,
    target_port INTEGER DEFAULT 443,
    rotation_strategy VARCHAR(20) DEFAULT 'round_robin',
    rotation_mode VARCHAR(20) DEFAULT 'interval',
    interval_minutes INTEGER DEFAULT 60,
    scheduled_times JSONB DEFAULT '[]',
    health_check_enabled BOOLEAN DEFAULT true,
    current_machine_id UUID REFERENCES machines(id) ON DELETE SET NULL,
    current_index INTEGER DEFAULT 0,
    is_paused BOOLEAN DEFAULT false,
    last_rotated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(dns_domain_id)
);

-- Wildcard pool members
CREATE TABLE IF NOT EXISTS dns_wildcard_pool_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id UUID NOT NULL REFERENCES dns_wildcard_pools(id) ON DELETE CASCADE,
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    priority INTEGER DEFAULT 0,
    is_enabled BOOLEAN DEFAULT true,
    nginx_config_applied BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(pool_id, machine_id)
);

-- Rotation history for auditing
CREATE TABLE IF NOT EXISTS dns_rotation_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_type VARCHAR(20) NOT NULL,           -- 'record' or 'wildcard'
    pool_id UUID NOT NULL,                    -- References either passthrough_pools or wildcard_pools
    dns_domain_id UUID REFERENCES dns_managed_domains(id) ON DELETE SET NULL,
    record_name VARCHAR(255),                 -- For record pools: the subdomain name
    from_machine_id UUID REFERENCES machines(id) ON DELETE SET NULL,
    from_ip VARCHAR(255),
    to_machine_id UUID REFERENCES machines(id) ON DELETE SET NULL,
    to_ip VARCHAR(255),
    trigger VARCHAR(20) NOT NULL,             -- 'scheduled', 'manual', 'health'
    rotated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_passthrough_pools_record ON dns_passthrough_pools(dns_record_id);
CREATE INDEX IF NOT EXISTS idx_passthrough_members_pool ON dns_passthrough_members(pool_id);
CREATE INDEX IF NOT EXISTS idx_passthrough_members_machine ON dns_passthrough_members(machine_id);
CREATE INDEX IF NOT EXISTS idx_wildcard_pools_domain ON dns_wildcard_pools(dns_domain_id);
CREATE INDEX IF NOT EXISTS idx_wildcard_members_pool ON dns_wildcard_pool_members(pool_id);
CREATE INDEX IF NOT EXISTS idx_wildcard_members_machine ON dns_wildcard_pool_members(machine_id);
CREATE INDEX IF NOT EXISTS idx_rotation_history_pool ON dns_rotation_history(pool_type, pool_id);
CREATE INDEX IF NOT EXISTS idx_rotation_history_time ON dns_rotation_history(rotated_at);

