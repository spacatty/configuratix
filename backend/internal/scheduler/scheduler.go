package scheduler

import (
	"log"
	"net"
	"net/http"
	"time"

	"configuratix/backend/internal/database"
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

	var domains []DomainCheck
	err := s.db.Select(&domains, `
		SELECT d.id, d.fqdn, d.assigned_machine_id, m.ip_address as machine_ip, d.status
		FROM domains d
		LEFT JOIN machines m ON d.assigned_machine_id = m.id
	`)
	if err != nil {
		log.Printf("Failed to get domains for health check: %v", err)
		return
	}

	for _, domain := range domains {
		newStatus := s.checkDomainStatus(domain)
		
		if newStatus != domain.Status {
			_, err := s.db.Exec(`
				UPDATE domains SET status = $1, last_check_at = NOW(), updated_at = NOW()
				WHERE id = $2
			`, newStatus, domain.ID)
			if err != nil {
				log.Printf("Failed to update domain status: %v", err)
			} else {
				log.Printf("Domain %s status changed: %s -> %s", domain.FQDN, domain.Status, newStatus)
			}
		} else {
			// Update last_check_at even if status unchanged
			s.db.Exec("UPDATE domains SET last_check_at = NOW() WHERE id = $1", domain.ID)
		}
	}

	log.Println("Domain health checks complete")
}

type DomainCheck struct {
	ID                string  `db:"id"`
	FQDN              string  `db:"fqdn"`
	AssignedMachineID *string `db:"assigned_machine_id"`
	MachineIP         *string `db:"machine_ip"`
	Status            string  `db:"status"`
}

func (s *Scheduler) checkDomainStatus(domain DomainCheck) string {
	// If not assigned to a machine, status is idle
	if domain.AssignedMachineID == nil {
		return "idle"
	}

	// Check DNS
	ips, err := net.LookupIP(domain.FQDN)
	if err != nil {
		return "unhealthy"
	}

	// Check if DNS points to the assigned machine
	dnsMatchesMachine := false
	if domain.MachineIP != nil {
		for _, ip := range ips {
			if ip.String() == *domain.MachineIP {
				dnsMatchesMachine = true
				break
			}
		}
	}

	if !dnsMatchesMachine {
		return "unhealthy"
	}

	// Try HTTP(S) connection
	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse // Don't follow redirects
		},
	}

	// Try HTTPS first
	resp, err := client.Get("https://" + domain.FQDN)
	if err == nil {
		resp.Body.Close()
		return "healthy"
	}

	// Try HTTP
	resp, err = client.Get("http://" + domain.FQDN)
	if err == nil {
		resp.Body.Close()
		return "healthy"
	}

	return "unhealthy"
}

