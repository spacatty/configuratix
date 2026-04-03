-- Category-scoped tags for tracker items
CREATE TABLE IF NOT EXISTS tracker_tags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id     UUID NOT NULL REFERENCES tracker_categories(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    color           TEXT NOT NULL DEFAULT '#6366f1',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tracker_tags_category_name ON tracker_tags(category_id, LOWER(TRIM(name)));
CREATE INDEX IF NOT EXISTS idx_tracker_tags_owner ON tracker_tags(owner_id);
CREATE INDEX IF NOT EXISTS idx_tracker_tags_category ON tracker_tags(category_id);

-- Item-to-tag mapping (many tags per item)
CREATE TABLE IF NOT EXISTS tracker_item_tags (
    item_id         UUID NOT NULL REFERENCES tracker_items(id) ON DELETE CASCADE,
    tag_id          UUID NOT NULL REFERENCES tracker_tags(id) ON DELETE CASCADE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (item_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_tracker_item_tags_item ON tracker_item_tags(item_id);
CREATE INDEX IF NOT EXISTS idx_tracker_item_tags_tag ON tracker_item_tags(tag_id);
