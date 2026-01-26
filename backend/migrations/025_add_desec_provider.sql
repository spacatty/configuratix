-- Add deSEC as a valid DNS provider
-- Drop old constraint and add new one with all providers included

ALTER TABLE dns_accounts DROP CONSTRAINT IF EXISTS dns_accounts_provider_check;
ALTER TABLE dns_accounts ADD CONSTRAINT dns_accounts_provider_check 
    CHECK (provider IN ('dnspod', 'cloudflare', 'desec', 'njalla', 'cloudns'));

