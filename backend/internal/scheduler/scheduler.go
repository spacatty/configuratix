package scheduler

import (
	"log"
	"time"

	"configuratix/backend/internal/database"
	"configuratix/backend/internal/domainhealth"

	"github.com/google/uuid"
)

type Scheduler struct {
	db       *database.DB
	interval time.Duration
	stop     chan struct{}
}

func New(db *database.DB, intervalHours int) *Scheduler {
	if intervalHours < 1 {
		intervalHours = 1
	}
	return &Scheduler{
		db:       db,
		interval: time.Duration(intervalHours) * time.Hour,
		stop:     make(chan struct{}),
	}
}

func (s *Scheduler) Start() {
	go s.run()
}

func (s *Scheduler) Stop() {
	close(s.stop)
}

func (s *Scheduler) run() {
	// Run immediately on start
	s.checkDomains()

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.checkDomains()
		case <-s.stop:
			return
		}
	}
}

func (s *Scheduler) checkDomains() {
	log.Println("Running domain health checks...")

	var ids []struct {
		ID uuid.UUID `db:"id"`
	}
	err := s.db.Select(&ids, `SELECT id FROM domains`)
	if err != nil {
		log.Printf("Failed to get domains for health check: %v", err)
		return
	}

	for _, row := range ids {
		prev := ""
		_ = s.db.Get(&prev, `SELECT status FROM domains WHERE id = $1`, row.ID)
		newStatus, err := domainhealth.RunCheckAndPersist(s.db, row.ID)
		if err != nil {
			log.Printf("Domain health check failed for %s: %v", row.ID, err)
			continue
		}
		if newStatus != prev {
			var fqdn string
			_ = s.db.Get(&fqdn, `SELECT fqdn FROM domains WHERE id = $1`, row.ID)
			log.Printf("Domain %s status changed: %s -> %s", fqdn, prev, newStatus)
		}
	}

	log.Println("Domain health checks complete")
}
