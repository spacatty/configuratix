-- Migration 026_add_njalla_provider.sql
-- Add njalla as a valid DNS provider (includes all providers for idempotency)

ALTER TABLE dns_accounts DROP CONSTRAINT IF EXISTS dns_accounts_provider_check;
ALTER TABLE dns_accounts ADD CONSTRAINT dns_accounts_provider_check
    CHECK (provider IN ('dnspod', 'cloudflare', 'desec', 'njalla', 'cloudns'));

