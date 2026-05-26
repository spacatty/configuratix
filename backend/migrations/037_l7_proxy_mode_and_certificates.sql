-- Layer 7 reverse proxy mode for DNS passthrough domains.
-- Keeps existing L4 passthrough modes and adds L7 cert-managed routing.

-- Domain proxy mode: static | separate | wildcard | layer7
-- (no enum/check constraint in legacy schema, so only docs + app validation).

-- Per-pool upstream options for L7 reverse proxying.
ALTER TABLE dns_passthrough_pools
    ADD COLUMN IF NOT EXISTS target_scheme VARCHAR(10) DEFAULT 'http',
    ADD COLUMN IF NOT EXISTS preserve_host BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS tls_verify_upstream BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS ssl_email VARCHAR(255) DEFAULT 'admin@example.com';

ALTER TABLE dns_wildcard_pools
    ADD COLUMN IF NOT EXISTS target_scheme VARCHAR(10) DEFAULT 'http',
    ADD COLUMN IF NOT EXISTS preserve_host BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS tls_verify_upstream BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS ssl_email VARCHAR(255) DEFAULT 'admin@example.com';

-- L7 certificate status snapshot per proxy machine/domain.
CREATE TABLE IF NOT EXISTS dns_l7_certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    domain VARCHAR(255) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'missing', -- missing, issuing, valid, expiring, renewing, failed
    expires_at TIMESTAMP WITH TIME ZONE,
    issuer TEXT,
    last_checked_at TIMESTAMP WITH TIME ZONE,
    last_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    last_error TEXT,
    auto_renew_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(machine_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_dns_l7_certs_machine ON dns_l7_certificates(machine_id);
CREATE INDEX IF NOT EXISTS idx_dns_l7_certs_domain ON dns_l7_certificates(domain);
