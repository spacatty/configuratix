-- Custom config categories for machines
-- Allows users to define their own config file paths per machine

CREATE TABLE config_categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id      UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,           -- Category name, e.g., "My App Configs"
    emoji           TEXT DEFAULT '📁',
    color           TEXT DEFAULT '#6366f1',
    position        INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(machine_id, name)
);

CREATE INDEX idx_config_categories_machine ON config_categories(machine_id);

-- Config paths within a category
CREATE TABLE config_paths (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id     UUID NOT NULL REFERENCES config_categories(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,           -- Display name
    path            TEXT NOT NULL,           -- Full file path
    file_type       TEXT DEFAULT 'text',     -- text, nginx, php, shell, yaml, json
    reload_command  TEXT,                    -- Optional: command to run after save
    position        INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(category_id, path)
);

CREATE INDEX idx_config_paths_category ON config_paths(category_id);

