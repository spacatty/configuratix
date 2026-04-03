-- ============================================
-- Tracker module: categories, items, renewals, notifications
-- ============================================

-- Tracker categories (user-scoped; defaults created on first list per user)
CREATE TABLE IF NOT EXISTS tracker_categories (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    icon                TEXT DEFAULT '📁',
    color               TEXT DEFAULT '#6366f1',
    position            INTEGER DEFAULT 0,
    notify_days_before  INTEGER DEFAULT 3,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(owner_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tracker_categories_owner ON tracker_categories(owner_id);

-- Tracker items (subscriptions, servers, domains to track)
CREATE TABLE IF NOT EXISTS tracker_items (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id             UUID REFERENCES tracker_categories(id) ON DELETE SET NULL,
    name                    TEXT NOT NULL,
    resource_ref            TEXT NOT NULL,
    purchase_time           TIMESTAMP WITH TIME ZONE,
    order_date              TIMESTAMP WITH TIME ZONE,
    expiry_at               TIMESTAMP WITH TIME ZONE,
    recurring_period_type   VARCHAR(20),
    recurring_period_days   INTEGER,
    price_usd               NUMERIC(12, 2),
    notes_md                TEXT,
    last_notified_at        TIMESTAMP WITH TIME ZONE,
    next_notification_at    TIMESTAMP WITH TIME ZONE,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracker_items_owner ON tracker_items(owner_id);
CREATE INDEX IF NOT EXISTS idx_tracker_items_category ON tracker_items(category_id);
CREATE INDEX IF NOT EXISTS idx_tracker_items_expiry ON tracker_items(expiry_at);
CREATE INDEX IF NOT EXISTS idx_tracker_items_next_notification ON tracker_items(next_notification_at) WHERE next_notification_at IS NOT NULL;

-- Renewal/payment history for expense calculation and audit
CREATE TABLE IF NOT EXISTS tracker_renewals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id         UUID NOT NULL REFERENCES tracker_items(id) ON DELETE CASCADE,
    renewed_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expiry_before   TIMESTAMP WITH TIME ZONE,
    expiry_after    TIMESTAMP WITH TIME ZONE NOT NULL,
    amount_usd      NUMERIC(12, 2),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracker_renewals_item ON tracker_renewals(item_id);

-- Persisted notifications (inbox)
CREATE TABLE IF NOT EXISTS tracker_notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id     UUID REFERENCES tracker_items(id) ON DELETE SET NULL,
    title       TEXT NOT NULL,
    body        TEXT,
    type        VARCHAR(50) NOT NULL,
    read_at     TIMESTAMP WITH TIME ZONE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracker_notifications_owner ON tracker_notifications(owner_id);
CREATE INDEX IF NOT EXISTS idx_tracker_notifications_read ON tracker_notifications(owner_id, read_at);
CREATE INDEX IF NOT EXISTS idx_tracker_notifications_created ON tracker_notifications(created_at DESC);
