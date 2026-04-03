-- Category identifier label (e.g. IP, Domain) and item identifier value
ALTER TABLE tracker_categories ADD COLUMN IF NOT EXISTS identifier_label TEXT DEFAULT '';
ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS identifier_value TEXT DEFAULT '';
