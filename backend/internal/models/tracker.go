package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type TrackerCategory struct {
	ID                 uuid.UUID  `db:"id" json:"id"`
	OwnerID            uuid.UUID  `db:"owner_id" json:"owner_id"`
	Name               string     `db:"name" json:"name"`
	Icon               string     `db:"icon" json:"icon"`
	Color              string     `db:"color" json:"color"`
	Position           int        `db:"position" json:"position"`
	NotifyDaysBefore   int        `db:"notify_days_before" json:"notify_days_before"`
	IdentifierLabel    string     `db:"identifier_label" json:"identifier_label"`
	CreatedAt          time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt          time.Time  `db:"updated_at" json:"updated_at"`
}

type TrackerCategoryWithCount struct {
	TrackerCategory
	ItemCount int `db:"item_count" json:"item_count"`
}

type TrackerResource struct {
	ID        uuid.UUID  `db:"id" json:"id"`
	OwnerID   uuid.UUID  `db:"owner_id" json:"owner_id"`
	Name      string     `db:"name" json:"name"`
	URL       *string    `db:"url" json:"url"`
	NotesMD   *string    `db:"notes_md" json:"notes_md"`
	CreatedAt time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt time.Time  `db:"updated_at" json:"updated_at"`
}

type TrackerItem struct {
	ID                   uuid.UUID   `db:"id" json:"id"`
	OwnerID              uuid.UUID   `db:"owner_id" json:"owner_id"`
	CategoryID           *uuid.UUID  `db:"category_id" json:"category_id"`
	Name                 string      `db:"name" json:"name"`
	IdentifierValue      string      `db:"identifier_value" json:"identifier_value"`
	ResourceID           *uuid.UUID  `db:"resource_id" json:"resource_id"`
	PurchaseTime         *time.Time  `db:"purchase_time" json:"purchase_time"`
	OrderDate            *time.Time  `db:"order_date" json:"order_date"`
	ExpiryAt             *time.Time  `db:"expiry_at" json:"expiry_at"`
	RecurringPeriodType  *string     `db:"recurring_period_type" json:"recurring_period_type"`
	RecurringPeriodDays  *int        `db:"recurring_period_days" json:"recurring_period_days"`
	PriceUsd             *float64    `db:"price_usd" json:"price_usd"`
	NotesMD              *string     `db:"notes_md" json:"notes_md"`
	LastNotifiedAt       *time.Time  `db:"last_notified_at" json:"last_notified_at"`
	NextNotificationAt   *time.Time  `db:"next_notification_at" json:"next_notification_at"`
	CreatedAt            time.Time   `db:"created_at" json:"created_at"`
	UpdatedAt            time.Time   `db:"updated_at" json:"updated_at"`
}

type TrackerItemWithCategory struct {
	TrackerItem
	CategoryName            *string         `db:"category_name" json:"category_name"`
	CategoryIcon            *string         `db:"category_icon" json:"category_icon"`
	CategoryColor           *string         `db:"category_color" json:"category_color"`
	CategoryIdentifierLabel *string         `db:"category_identifier_label" json:"category_identifier_label"`
	ResourceName            *string         `db:"resource_name" json:"resource_name"`
	ResourceURL             *string         `db:"resource_url" json:"resource_url"`
	Tags                    json.RawMessage `db:"tags" json:"tags"`
}

type TrackerTag struct {
	ID         uuid.UUID  `db:"id" json:"id"`
	OwnerID    uuid.UUID  `db:"owner_id" json:"owner_id"`
	CategoryID uuid.UUID  `db:"category_id" json:"category_id"`
	Name       string     `db:"name" json:"name"`
	Color      string     `db:"color" json:"color"`
	CreatedAt  time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt  time.Time  `db:"updated_at" json:"updated_at"`
}

type TrackerItemTag struct {
	ItemID    uuid.UUID `db:"item_id" json:"item_id"`
	TagID     uuid.UUID `db:"tag_id" json:"tag_id"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
}

type TrackerRenewal struct {
	ID           uuid.UUID  `db:"id" json:"id"`
	ItemID       uuid.UUID  `db:"item_id" json:"item_id"`
	RenewedAt    time.Time  `db:"renewed_at" json:"renewed_at"`
	ExpiryBefore *time.Time `db:"expiry_before" json:"expiry_before"`
	ExpiryAfter  time.Time  `db:"expiry_after" json:"expiry_after"`
	AmountUsd    *float64   `db:"amount_usd" json:"amount_usd"`
	CreatedAt    time.Time  `db:"created_at" json:"created_at"`
}

type TrackerNotification struct {
	ID        uuid.UUID   `db:"id" json:"id"`
	OwnerID   uuid.UUID   `db:"owner_id" json:"owner_id"`
	ItemID    *uuid.UUID  `db:"item_id" json:"item_id"`
	Title     string      `db:"title" json:"title"`
	Body      *string     `db:"body" json:"body"`
	Type      string      `db:"type" json:"type"`
	ReadAt    *time.Time  `db:"read_at" json:"read_at"`
	CreatedAt time.Time   `db:"created_at" json:"created_at"`
}

type TrackerNotificationWithItem struct {
	TrackerNotification
	ItemName *string `db:"item_name" json:"item_name"`
}

type TrackerDashboardSummary struct {
	MonthlyRecurringExpense float64        `json:"monthly_recurring_expense"`
	TotalSpent              float64        `json:"total_spent"`
	ClosestPayment          *TrackerItem   `json:"closest_payment,omitempty"`
	DueSoonCount            int            `json:"due_soon_count"`
	OverdueCount            int            `json:"overdue_count"`
}
