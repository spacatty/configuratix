package services

import (
	"fmt"
	"log"
	"strings"
	"time"

	"configuratix/backend/internal/database"

	"github.com/google/uuid"
)

const (
	trackerCheckInterval = 15 * time.Minute
	overdueRepeatHours   = 8
)

type TrackerScheduler struct {
	db               *database.DB
	stop             chan struct{}
	schemaWarnLogged bool // log once when tracker_items table is missing (migrations not fully applied)
}

func NewTrackerScheduler(db *database.DB) *TrackerScheduler {
	return &TrackerScheduler{
		db:   db,
		stop: make(chan struct{}),
	}
}

func (s *TrackerScheduler) Start() {
	log.Println("Tracker reminder scheduler started")
	ticker := time.NewTicker(trackerCheckInterval)
	defer ticker.Stop()

	s.tick()

	for {
		select {
		case <-ticker.C:
			s.tick()
		case <-s.stop:
			log.Println("Tracker reminder scheduler stopped")
			return
		}
	}
}

func (s *TrackerScheduler) Stop() {
	close(s.stop)
}

func (s *TrackerScheduler) tick() {
	now := time.Now().UTC()

	type itemRow struct {
		ID                uuid.UUID  `db:"id"`
		OwnerID           uuid.UUID  `db:"owner_id"`
		Name              string     `db:"name"`
		ExpiryAt          *time.Time `db:"expiry_at"`
		LastNotifiedAt    *time.Time `db:"last_notified_at"`
		NextNotificationAt *time.Time `db:"next_notification_at"`
		CategoryNotifyDays int       `db:"notify_days_before"`
	}

	var items []itemRow
	err := s.db.Select(&items, `
		SELECT i.id, i.owner_id, i.name, i.expiry_at, i.last_notified_at, i.next_notification_at,
		       COALESCE(c.notify_days_before, 3) as notify_days_before
		FROM tracker_items i
		LEFT JOIN tracker_categories c ON i.category_id = c.id
		WHERE i.expiry_at IS NOT NULL
	`)
	if err != nil {
		if strings.Contains(err.Error(), "tracker_items") && strings.Contains(err.Error(), "does not exist") {
			if !s.schemaWarnLogged {
				s.schemaWarnLogged = true
				log.Printf("Tracker scheduler skipped: migrations not fully applied (tracker_items missing). Run app when DB is reachable to complete migrations.")
			}
			return
		}
		log.Printf("Tracker scheduler: failed to get items: %v", err)
		return
	}

	for _, it := range items {
		if it.ExpiryAt == nil {
			continue
		}
		expiry := *it.ExpiryAt
		dueSoonThreshold := now.AddDate(0, 0, it.CategoryNotifyDays)

		if expiry.After(now) {
			// Due soon: expiry within notify_days; notify only once per window (when last_notified_at is null)
			if expiry.After(dueSoonThreshold) {
				continue
			}
			if it.LastNotifiedAt != nil {
				continue
			}
			hoursLeft := expiry.Sub(now).Hours()
			title := fmt.Sprintf("Due soon: %s", it.Name)
			body := fmt.Sprintf("Expires in %.0f hours (by %s).", hoursLeft, expiry.Format("2006-01-02 15:04"))
			s.createNotification(it.OwnerID, &it.ID, title, body, "due_soon")
			s.db.Exec(`
				UPDATE tracker_items SET last_notified_at = $1, next_notification_at = $2, updated_at = NOW()
				WHERE id = $3
			`, now, expiry, it.ID)
		} else {
			// Overdue: repeat every 8 hours
			shouldNotify := it.NextNotificationAt == nil || !it.NextNotificationAt.After(now)
			if !shouldNotify {
				continue
			}
			hoursLeft := -now.Sub(expiry).Hours()
			title := fmt.Sprintf("Overdue: %s", it.Name)
			body := fmt.Sprintf("Expired %.0f hours ago. Service may be down.", hoursLeft)
			s.createNotification(it.OwnerID, &it.ID, title, body, "overdue")
			nextAt := now.Add(overdueRepeatHours * time.Hour)
			s.db.Exec(`
				UPDATE tracker_items SET last_notified_at = $1, next_notification_at = $2, updated_at = NOW()
				WHERE id = $3
			`, now, nextAt, it.ID)
		}
	}
}

func (s *TrackerScheduler) createNotification(ownerID uuid.UUID, itemID *uuid.UUID, title, body, typ string) {
	_, err := s.db.Exec(`
		INSERT INTO tracker_notifications (owner_id, item_id, title, body, type)
		VALUES ($1, $2, $3, $4, $5)
	`, ownerID, itemID, title, body, typ)
	if err != nil {
		log.Printf("Tracker scheduler: failed to create notification: %v", err)
	}
}
