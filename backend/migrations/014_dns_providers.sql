-- DNS Provider Accounts (per-user, multiple accounts per provider)
CREATE TABLE dns_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL CHECK (provider IN ('dnspod', 'cloudflare')),
    name            TEXT NOT NULL,                    -- "My DNSPod #1", "CF Work Account"
    api_id          TEXT,                             -- DNSPod: login_token ID, CF: not used
    api_token       TEXT NOT NULL,                    -- DNSPod: token, CF: API token
    is_default      BOOLEAN DEFAULT false,            -- Default account for this provider
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_dns_accounts_owner ON dns_accounts(owner_id);

-- Extend domains table with DNS settings
ALTER TABLE domains ADD COLUMN dns_account_id UUID REFERENCES dns_accounts(id) ON DELETE SET NULL;
ALTER TABLE domains ADD COLUMN dns_mode TEXT DEFAULT 'external' 
    CHECK (dns_mode IN ('managed', 'external'));
ALTER TABLE domains ADD COLUMN ns_status TEXT DEFAULT 'unknown'
    CHECK (ns_status IN ('unknown', 'pending', 'valid', 'invalid'));
ALTER TABLE domains ADD COLUMN ns_last_check TIMESTAMP;
ALTER TABLE domains ADD COLUMN ns_expected TEXT[];
ALTER TABLE domains ADD COLUMN ns_actual TEXT[];
ALTER TABLE domains ADD COLUMN is_wildcard BOOLEAN DEFAULT false;
ALTER TABLE domains ADD COLUMN ip_address TEXT;
ALTER TABLE domains ADD COLUMN https_send_proxy BOOLEAN DEFAULT false;

-- Port configuration per domain (for nginx generation)
ALTER TABLE domains ADD COLUMN http_incoming_ports INTEGER[] DEFAULT '{80}';
ALTER TABLE domains ADD COLUMN http_outgoing_ports INTEGER[] DEFAULT '{80}';
ALTER TABLE domains ADD COLUMN https_incoming_ports INTEGER[] DEFAULT '{443}';
ALTER TABLE domains ADD COLUMN https_outgoing_ports INTEGER[] DEFAULT '{443}';

-- DNS Records (our desired state)
CREATE TABLE dns_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_id       UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,                    -- subdomain: "www", "@", "*"
    record_type     TEXT NOT NULL CHECK (record_type IN ('A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS')),
    value           TEXT NOT NULL,                    -- IP, target domain, txt value
    ttl             INTEGER DEFAULT 600,
    priority        INTEGER,                          -- For MX records
    proxied         BOOLEAN DEFAULT false,            -- CF-specific: orange cloud
    
    -- Port overrides per record (for nginx)
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

CREATE INDEX idx_dns_records_domain ON dns_records(domain_id);
CREATE INDEX idx_dns_records_sync ON dns_records(sync_status);
CREATE UNIQUE INDEX idx_dns_records_unique ON dns_records(domain_id, name, record_type);

