-- Migration 027_add_cloudns_provider.sql
-- Add cloudns as a valid DNS provider

ALTER TABLE dns_accounts DROP CONSTRAINT IF EXISTS dns_accounts_provider_check;
ALTER TABLE dns_accounts ADD CONSTRAINT dns_accounts_provider_check
    CHECK (provider IN ('dnspod', 'cloudflare', 'desec', 'njalla', 'cloudns'));

