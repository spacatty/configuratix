-- Domain Groups for organizing domains (mirrors machine_groups pattern)
CREATE TABLE domain_groups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    emoji           TEXT DEFAULT '📁',
    color           TEXT DEFAULT '#6366f1',
    position        INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),

    UNIQUE(owner_id, name)
);

CREATE INDEX idx_domain_groups_owner ON domain_groups(owner_id);

CREATE TABLE domain_group_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id        UUID NOT NULL REFERENCES domain_groups(id) ON DELETE CASCADE,
    domain_id       UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    position        INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT NOW(),

    UNIQUE(group_id, domain_id)
);

CREATE INDEX idx_domain_group_members_group ON domain_group_members(group_id);
CREATE INDEX idx_domain_group_members_domain ON domain_group_members(domain_id);
