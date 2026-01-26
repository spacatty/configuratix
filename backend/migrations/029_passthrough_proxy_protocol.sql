-- Migration 029_passthrough_proxy_protocol.sql
-- Add proxy_protocol option to passthrough pools (default true for backwards compatibility)

ALTER TABLE dns_passthrough_pools ADD COLUMN IF NOT EXISTS proxy_protocol BOOLEAN DEFAULT true;
ALTER TABLE dns_wildcard_pools ADD COLUMN IF NOT EXISTS proxy_protocol BOOLEAN DEFAULT true;
