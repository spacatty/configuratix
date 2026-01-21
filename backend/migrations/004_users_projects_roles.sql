-- ============================================
-- User Roles and 2FA
-- ============================================

-- Add role column to users (superadmin, admin, user)
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';

-- Add 2FA columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP WITH TIME ZONE;

-- Add name for display
ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(255);

-- ============================================
-- Projects
-- ============================================

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notes_md TEXT DEFAULT '',
    sharing_enabled BOOLEAN DEFAULT FALSE,
    invite_token VARCHAR(255) UNIQUE,
    invite_expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_invite_token ON projects(invite_token);

-- ============================================
-- Project Members
-- ============================================

CREATE TABLE IF NOT EXISTS project_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'member', -- member, manager
    can_view_notes BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, denied
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_status ON project_members(status);

-- ============================================
-- Machine Ownership and Tokens
-- ============================================

-- Add owner to machines
ALTER TABLE machines ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Add project linking
ALTER TABLE machines ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

-- Add configurable title
ALTER TABLE machines ADD COLUMN IF NOT EXISTS title VARCHAR(255);

-- Add access token protection
ALTER TABLE machines ADD COLUMN IF NOT EXISTS access_token_hash VARCHAR(255);
ALTER TABLE machines ADD COLUMN IF NOT EXISTS access_token_set BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_machines_owner_id ON machines(owner_id);
CREATE INDEX IF NOT EXISTS idx_machines_project_id ON machines(project_id);

-- ============================================
-- Update enrollment tokens to include owner
-- ============================================

ALTER TABLE enrollment_tokens ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- ============================================
-- Add owner to domains
-- ============================================

ALTER TABLE domains ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- ============================================
-- Add owner to nginx configs
-- ============================================

ALTER TABLE nginx_configs ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;

