-- Separate DNS Management domains from main domains table
-- DNS management is completely independent module

-- 1. Create dns_managed_domains table (completely independent from domains)
CREATE TABLE dns_managed_domains (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fqdn            TEXT NOT NULL,
    dns_account_id  UUID REFERENCES dns_accounts(id) ON DELETE SET NULL,
    ns_status       TEXT DEFAULT 'unknown'
        CHECK (ns_status IN ('unknown', 'pending', 'valid', 'invalid')),
    ns_last_check   TIMESTAMP,
    ns_expected     TEXT[],
    ns_actual       TEXT[],
    notes_md        TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(owner_id, fqdn)
);

CREATE INDEX idx_dns_managed_domains_owner ON dns_managed_domains(owner_id);
CREATE INDEX idx_dns_managed_domains_fqdn ON dns_managed_domains(fqdn);

-- 2. Migrate existing domains with DNS configuration to the new table
-- Only migrate domains that have an owner_id (DNS management requires user ownership)
INSERT INTO dns_managed_domains (owner_id, fqdn, dns_account_id, ns_status, ns_last_check, ns_expected, ns_actual, created_at, updated_at)
SELECT 
    owner_id, 
    fqdn, 
    dns_account_id, 
    COALESCE(ns_status, 'unknown'),
    ns_last_check, 
    ns_expected, 
    ns_actual,
    created_at,
    updated_at
FROM domains 
WHERE (dns_account_id IS NOT NULL OR dns_mode = 'managed')
  AND owner_id IS NOT NULL;

-- 3. Create new dns_records table referencing dns_managed_domains
-- First, create a mapping from old domain_id to new dns_managed_domain_id
CREATE TEMP TABLE domain_mapping AS
SELECT 
    d.id as old_domain_id,
    dmd.id as new_domain_id
FROM domains d
JOIN dns_managed_domains dmd ON d.fqdn = dmd.fqdn AND d.owner_id = dmd.owner_id;

-- 4. Create new dns_records_new table with correct reference
CREATE TABLE dns_records_new (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dns_domain_id   UUID NOT NULL REFERENCES dns_managed_domains(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,                    -- subdomain: "www", "@", "*"
    record_type     TEXT NOT NULL CHECK (record_type IN ('A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS')),
    value           TEXT NOT NULL,                    -- IP, target domain, txt value
    ttl             INTEGER DEFAULT 600,
    priority        INTEGER,                          -- For MX records
    proxied         BOOLEAN DEFAULT false,            -- CF-specific: orange cloud
    
    -- Port overrides per record (for nginx - keeping for flexibility)
    http_incoming_port  INTEGER,
    http_outgoing_port  INTEGER,
    https_incoming_port INTEGER,
    https_outgoing_port INTEGER,
    
    -- Sync status
    remote_record_id TEXT,                            -- ID from provider (for updates)
    sync_status     TEXT DEFAULT 'pending' 
        CHECK (sync_status IN ('synced', 'pending', 'conflict', 'local_only', 'remote_only', 'error')),
    sync_error      TEXT,
    last_synced_at  TIMESTAMP,
    
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- 5. Copy existing dns_records to new table with updated references
INSERT INTO dns_records_new (
    id, dns_domain_id, name, record_type, value, ttl, priority, proxied,
    http_incoming_port, http_outgoing_port, https_incoming_port, https_outgoing_port,
    remote_record_id, sync_status, sync_error, last_synced_at, created_at, updated_at
)
SELECT 
    r.id, 
    m.new_domain_id,
    r.name, 
    r.record_type, 
    r.value, 
    r.ttl, 
    r.priority, 
    r.proxied,
    r.http_incoming_port, 
    r.http_outgoing_port, 
    r.https_incoming_port, 
    r.https_outgoing_port,
    r.remote_record_id, 
    r.sync_status, 
    r.sync_error, 
    r.last_synced_at, 
    r.created_at, 
    r.updated_at
FROM dns_records r
JOIN domain_mapping m ON r.domain_id = m.old_domain_id;

-- 6. Drop old dns_records table and rename new one
DROP TABLE dns_records;
ALTER TABLE dns_records_new RENAME TO dns_records;

-- 7. Recreate indexes on dns_records
CREATE INDEX idx_dns_records_domain ON dns_records(dns_domain_id);
CREATE INDEX idx_dns_records_sync ON dns_records(sync_status);
CREATE UNIQUE INDEX idx_dns_records_unique ON dns_records(dns_domain_id, name, record_type);

-- 8. Remove DNS-related columns from domains table
ALTER TABLE domains DROP COLUMN IF EXISTS dns_account_id;
ALTER TABLE domains DROP COLUMN IF EXISTS dns_mode;
ALTER TABLE domains DROP COLUMN IF EXISTS ns_status;
ALTER TABLE domains DROP COLUMN IF EXISTS ns_last_check;
ALTER TABLE domains DROP COLUMN IF EXISTS ns_expected;
ALTER TABLE domains DROP COLUMN IF EXISTS ns_actual;
ALTER TABLE domains DROP COLUMN IF EXISTS is_wildcard;
ALTER TABLE domains DROP COLUMN IF EXISTS ip_address;
ALTER TABLE domains DROP COLUMN IF EXISTS https_send_proxy;
ALTER TABLE domains DROP COLUMN IF EXISTS http_incoming_ports;
ALTER TABLE domains DROP COLUMN IF EXISTS http_outgoing_ports;
ALTER TABLE domains DROP COLUMN IF EXISTS https_incoming_ports;
ALTER TABLE domains DROP COLUMN IF EXISTS https_outgoing_ports;

-- Clean up
DROP TABLE domain_mapping;

