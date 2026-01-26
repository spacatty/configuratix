-- Migration 028_machine_ip_selection.sql
-- Add support for multiple IPs and primary IP selection

-- All detected IPs from machine interfaces (JSON array)
ALTER TABLE machines ADD COLUMN IF NOT EXISTS detected_ips JSONB DEFAULT '[]'::jsonb;

-- Primary IP to use for passthrough and DNS (selected by user or auto-detected)
ALTER TABLE machines ADD COLUMN IF NOT EXISTS primary_ip TEXT;

-- Copy existing ip_address to primary_ip if not set
UPDATE machines SET primary_ip = ip_address WHERE primary_ip IS NULL AND ip_address IS NOT NULL;

