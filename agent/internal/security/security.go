//go:build linux

package security

import (
	"encoding/json"
	"log"
	"net"
	"sync"
	"time"
)

// Ban represents a banned IP
type Ban struct {
	IPAddress string    `json:"ip_address"`
	Reason    string    `json:"reason"`
	Details   string    `json:"details"`
	ExpiresAt time.Time `json:"expires_at"`
	BannedAt  time.Time `json:"banned_at"`
}

// BanReport for sending to backend
type BanReport struct {
	IPAddress string          `json:"ip_address"`
	Reason    string          `json:"reason"`
	Details   json.RawMessage `json:"details"`
	BannedAt  time.Time       `json:"banned_at"`
	ExpiresAt *time.Time      `json:"expires_at,omitempty"`
}

// SyncRequest to backend
type SyncRequest struct {
	MachineID  string      `json:"machine_id"`
	NewBans    []BanReport `json:"new_bans"`
	LastSyncAt *time.Time  `json:"last_sync_at,omitempty"`
	BanCount   int         `json:"ban_count"`
}

// SyncResponse from backend
type SyncResponse struct {
	MissingBans      []BanEntry `json:"missing_bans"`
	BansToRemove     []string   `json:"bans_to_remove"`
	WhitelistUpdated bool       `json:"whitelist_updated"`
	Whitelist        []string   `json:"whitelist"`
	PatternsUpdated  bool       `json:"patterns_updated"`
	NextSyncAt       time.Time  `json:"next_sync_at"`
}

// BanEntry from backend
type BanEntry struct {
	IPAddress string    `json:"ip_address"`
	ExpiresAt time.Time `json:"expires_at"`
}

// UAPatternsResponse from backend
type UAPatternsResponse struct {
	Patterns  []string  `json:"patterns"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Config for security module
type Config struct {
	Enabled          bool
	ServerURL        string
	APIKey           string
	MachineID        string
	SyncInterval     time.Duration
	SecurityLogPath  string
	NginxIncludePath string
}

// Module is the main security module
type Module struct {
	config Config

	// State
	mu            sync.RWMutex
	localBans     map[string]*Ban    // IP -> Ban
	whitelist     map[string]bool    // IP/CIDR -> true
	whitelistNets []*net.IPNet       // Parsed CIDRs
	uaPatterns    []string           // UA patterns from backend
	pendingBans   []BanReport        // Bans to sync to backend
	lastSyncAt    *time.Time

	// Control
	stopCh   chan struct{}
	stopped  bool
	nftables *NftablesManager
	watcher  *LogWatcher
}

// New creates a new security module
func New(cfg Config) *Module {
	return &Module{
		config:      cfg,
		localBans:   make(map[string]*Ban),
		whitelist:   make(map[string]bool),
		pendingBans: []BanReport{},
		stopCh:      make(chan struct{}),
	}
}

// Start initializes and runs the security module
func (m *Module) Start() error {
	if !m.config.Enabled {
		log.Println("Security module disabled")
		return nil
	}

	log.Println("Starting security module...")

	// Initialize nftables
	m.nftables = NewNftablesManager()
	if err := m.nftables.Init(); err != nil {
		log.Printf("Failed to initialize nftables: %v", err)
		// Continue anyway - we can still log and sync
	}

	// Do initial sync to get whitelist, patterns, and existing bans
	if err := m.fullSync(); err != nil {
		log.Printf("Initial security sync failed: %v", err)
	}

	// Start log watcher
	m.watcher = NewLogWatcher(m.config.SecurityLogPath, m.handleBlockedRequest)
	go m.watcher.Watch()

	// Start sync loop
	go m.syncLoop()

	log.Println("Security module started")
	return nil
}

// Stop gracefully shuts down the security module
func (m *Module) Stop() {
	m.mu.Lock()
	if m.stopped {
		m.mu.Unlock()
		return
	}
	m.stopped = true
	m.mu.Unlock()

	close(m.stopCh)

	if m.watcher != nil {
		m.watcher.Stop()
	}

	log.Println("Security module stopped")
}

// IsEnabled returns whether security is enabled
func (m *Module) IsEnabled() bool {
	return m.config.Enabled
}

// handleBlockedRequest is called when log watcher detects a blocked request
func (m *Module) handleBlockedRequest(ip, reason, userAgent, path string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Check if already banned locally
	if _, exists := m.localBans[ip]; exists {
		return
	}

	// Check whitelist
	if m.isWhitelisted(ip) {
		log.Printf("Blocked request from whitelisted IP %s, ignoring", ip)
		return
	}

	// Calculate expiry (30 days from now)
	expiresAt := time.Now().Add(30 * 24 * time.Hour)

	// Add to local bans
	ban := &Ban{
		IPAddress: ip,
		Reason:    reason,
		Details:   userAgent,
		ExpiresAt: expiresAt,
		BannedAt:  time.Now(),
	}
	m.localBans[ip] = ban

	// Add to nftables
	if m.nftables != nil {
		if err := m.nftables.AddBan(ip, expiresAt); err != nil {
			log.Printf("Failed to add ban to nftables: %v", err)
		}
	}

	// Queue for sync
	details, _ := json.Marshal(map[string]string{
		"user_agent": userAgent,
		"path":       path,
	})
	m.pendingBans = append(m.pendingBans, BanReport{
		IPAddress: ip,
		Reason:    reason,
		Details:   details,
		BannedAt:  time.Now(),
		ExpiresAt: &expiresAt,
	})

	log.Printf("Banned IP %s (reason: %s)", ip, reason)
}

// isWhitelisted checks if an IP is in the whitelist
func (m *Module) isWhitelisted(ipStr string) bool {
	// Check exact match
	if m.whitelist[ipStr] {
		return true
	}

	// Check CIDR ranges
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return false
	}

	for _, cidr := range m.whitelistNets {
		if cidr.Contains(ip) {
			return true
		}
	}

	return false
}

// syncLoop periodically syncs with backend
func (m *Module) syncLoop() {
	ticker := time.NewTicker(m.config.SyncInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if err := m.deltaSync(); err != nil {
				log.Printf("Security sync failed: %v", err)
			}
		case <-m.stopCh:
			return
		}
	}
}

// GetBanCount returns the current number of bans
func (m *Module) GetBanCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.localBans)
}

// GetState returns the current nftables state
func (m *Module) GetState() *NftablesState {
	if m.nftables == nil {
		return &NftablesState{Enabled: false}
	}
	return m.nftables.GetState()
}

// SetEnabled enables or disables nftables enforcement
func (m *Module) SetEnabled(enabled bool) error {
	if m.nftables == nil {
		return nil
	}
	if enabled {
		return m.nftables.Enable()
	}
	return m.nftables.Disable()
}

// ClearAllBans removes all bans from nftables
func (m *Module) ClearAllBans() error {
	m.mu.Lock()
	m.localBans = make(map[string]*Ban)
	m.mu.Unlock()

	if m.nftables != nil {
		return m.nftables.ClearAll()
	}
	return nil
}

// GetUAPatterns returns the current UA patterns
func (m *Module) GetUAPatterns() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.uaPatterns
}

