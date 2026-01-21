-- Landing pages table
CREATE TABLE IF NOT EXISTS landings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(10) NOT NULL DEFAULT 'html', -- html, php
    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    storage_path VARCHAR(500) NOT NULL,
    preview_path VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_landings_owner_id ON landings(owner_id);

-- Add PHP status columns to machines
ALTER TABLE machines ADD COLUMN IF NOT EXISTS php_installed BOOLEAN DEFAULT false;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS php_version VARCHAR(20);

