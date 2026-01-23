-- Add HTTP port support for passthrough pools
-- This allows passing both 443 (HTTPS) and 80 (HTTP) traffic with different target ports

-- Add target_port_http to record passthrough pools (default 80 = same as incoming)
ALTER TABLE dns_passthrough_pools ADD COLUMN IF NOT EXISTS target_port_http INTEGER DEFAULT 80;

-- Add target_port_http to wildcard pools
ALTER TABLE dns_wildcard_pools ADD COLUMN IF NOT EXISTS target_port_http INTEGER DEFAULT 80;

-- Comment: target_port = where HTTPS (443) traffic goes
-- Comment: target_port_http = where HTTP (80) traffic goes

