-- ============================================
-- Tracker resources: first-class entity (name, url, notes)
-- Migrate resource_ref from tracker_items into tracker_resources
-- (resource_ref exists only if 032_tracker applied fully; guard for partial/old DBs)
-- ============================================

-- New table: user-scoped resources
CREATE TABLE IF NOT EXISTS tracker_resources (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    url         TEXT,
    notes_md    TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(owner_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tracker_resources_owner ON tracker_resources(owner_id);

-- Migrate existing distinct resource_ref values (only if column still exists)
DO $body$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tracker_items'
          AND column_name = 'resource_ref'
    ) THEN
        INSERT INTO tracker_resources (owner_id, name)
        SELECT DISTINCT owner_id, resource_ref
        FROM tracker_items
        WHERE resource_ref IS NOT NULL AND TRIM(resource_ref) != ''
        ON CONFLICT (owner_id, name) DO NOTHING;
    END IF;
END $body$;

-- Add resource_id to items (nullable until backfill)
ALTER TABLE tracker_items
ADD COLUMN IF NOT EXISTS resource_id UUID REFERENCES tracker_resources(id) ON DELETE SET NULL;

-- Backfill and drop resource_ref only when that column exists
DO $body$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tracker_items'
          AND column_name = 'resource_ref'
    ) THEN
        UPDATE tracker_items i
        SET resource_id = r.id
        FROM tracker_resources r
        WHERE r.owner_id = i.owner_id AND r.name = i.resource_ref;

        ALTER TABLE tracker_items DROP COLUMN IF EXISTS resource_ref;
    END IF;
END $body$;

CREATE INDEX IF NOT EXISTS idx_tracker_items_resource ON tracker_items(resource_id);
