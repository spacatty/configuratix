-- Machine Groups for organizing machines
CREATE TABLE machine_groups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    emoji           TEXT DEFAULT '📁',
    color           TEXT DEFAULT '#6366f1',  -- Default indigo
    position        INTEGER DEFAULT 0,       -- For ordering groups
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(owner_id, name)
);

CREATE INDEX idx_machine_groups_owner ON machine_groups(owner_id);

-- Junction table for many-to-many relationship (machine can be in multiple groups)
CREATE TABLE machine_group_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id        UUID NOT NULL REFERENCES machine_groups(id) ON DELETE CASCADE,
    machine_id      UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    position        INTEGER DEFAULT 0,       -- For ordering within group
    created_at      TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(group_id, machine_id)
);

CREATE INDEX idx_machine_group_members_group ON machine_group_members(group_id);
CREATE INDEX idx_machine_group_members_machine ON machine_group_members(machine_id);

