-- Machine settings and stats
ALTER TABLE machines ADD COLUMN IF NOT EXISTS ssh_port INTEGER DEFAULT 22;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS ufw_enabled BOOLEAN DEFAULT false;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS fail2ban_enabled BOOLEAN DEFAULT false;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS fail2ban_config TEXT;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS root_password_set BOOLEAN DEFAULT false;

-- System stats (updated via heartbeat)
ALTER TABLE machines ADD COLUMN IF NOT EXISTS cpu_percent REAL DEFAULT 0;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS memory_used BIGINT DEFAULT 0;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS memory_total BIGINT DEFAULT 0;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS disk_used BIGINT DEFAULT 0;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS disk_total BIGINT DEFAULT 0;

-- Default fail2ban SSH jail config
COMMENT ON COLUMN machines.fail2ban_config IS 'Custom fail2ban jail config, uses default SSH protection if empty';

