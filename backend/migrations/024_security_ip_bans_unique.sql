-- Add unique constraint on ip_address for ON CONFLICT to work
-- First remove duplicates (keep newest)
DELETE FROM security_ip_bans a USING security_ip_bans b
WHERE a.id < b.id AND a.ip_address = b.ip_address;

-- Add unique constraint
ALTER TABLE security_ip_bans ADD CONSTRAINT unique_ip_address UNIQUE (ip_address);

