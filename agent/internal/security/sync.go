//go:build linux

package security

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"time"
)

// fullSync does a complete sync on startup
func (m *Module) fullSync() error {
	log.Println("Performing full security sync...")

	// Get whitelist
	if err := m.syncWhitelist(); err != nil {
		log.Printf("Failed to sync whitelist: %v", err)
	}

	// Get UA patterns
	if err := m.syncUAPatterns(); err != nil {
		log.Printf("Failed to sync UA patterns: %v", err)
	}

	// Do delta sync to get bans
	return m.deltaSync()
}

// deltaSync syncs new bans bidirectionally
func (m *Module) deltaSync() error {
	m.mu.Lock()
	
	// Prepare request
	req := SyncRequest{
		MachineID:  m.config.MachineID,
		NewBans:    m.pendingBans,
		LastSyncAt: m.lastSyncAt,
		BanCount:   len(m.localBans),
	}
	
	// Clear pending bans
	m.pendingBans = []BanReport{}
	m.mu.Unlock()

	// Send request
	body, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("failed to marshal sync request: %w", err)
	}

	httpReq, err := http.NewRequest("POST", m.config.ServerURL+"/api/agent/security/sync", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-API-Key", m.config.APIKey)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return fmt.Errorf("sync request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("sync failed with status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var syncResp SyncResponse
	if err := json.NewDecoder(resp.Body).Decode(&syncResp); err != nil {
		return fmt.Errorf("failed to decode sync response: %w", err)
	}

	// Log what we received
	log.Printf("Sync response: %d missing bans, %d to remove, whitelist_updated=%v",
		len(syncResp.MissingBans), len(syncResp.BansToRemove), syncResp.WhitelistUpdated)

	// Process response
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	m.lastSyncAt = &now

	// Apply missing bans
	addedCount := 0
	for _, ban := range syncResp.MissingBans {
		// Check whitelist first
		if m.isWhitelisted(ban.IPAddress) {
			log.Printf("Skipping whitelisted IP from sync: %s", ban.IPAddress)
			continue
		}

		// Add to local bans
		m.localBans[ban.IPAddress] = &Ban{
			IPAddress: ban.IPAddress,
			ExpiresAt: ban.ExpiresAt,
			BannedAt:  now,
		}

		// Add to nftables
		if m.nftables != nil {
			if err := m.nftables.AddBan(ban.IPAddress, ban.ExpiresAt); err != nil {
				log.Printf("Failed to add ban to nftables: %v", err)
			}
		}
		addedCount++
	}

	// Update nginx ban file if we added any bans
	if addedCount > 0 {
		m.updateNginxBanFile()
	}

	// Remove bans for whitelisted/expired IPs
	for _, ipCidr := range syncResp.BansToRemove {
		// This could be an IP or CIDR
		ip := ipCidr
		if idx := strings.Index(ipCidr, "/"); idx > 0 {
			ip = ipCidr[:idx]
		}

		delete(m.localBans, ip)
		if m.nftables != nil {
			m.nftables.RemoveBan(ip)
		}
	}

	// Update whitelist if changed
	if syncResp.WhitelistUpdated {
		m.updateWhitelist(syncResp.Whitelist)
	}

	if len(syncResp.MissingBans) > 0 || len(syncResp.BansToRemove) > 0 {
		log.Printf("Security sync: +%d bans, -%d removed", 
			len(syncResp.MissingBans), len(syncResp.BansToRemove))
	}

	return nil
}

// syncWhitelist fetches the whitelist from backend
func (m *Module) syncWhitelist() error {
	httpReq, err := http.NewRequest("GET", m.config.ServerURL+"/api/agent/security/whitelist", nil)
	if err != nil {
		return err
	}
	httpReq.Header.Set("X-API-Key", m.config.APIKey)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("whitelist request failed with status %d", resp.StatusCode)
	}

	var whitelist []string
	if err := json.NewDecoder(resp.Body).Decode(&whitelist); err != nil {
		return err
	}

	m.mu.Lock()
	m.updateWhitelist(whitelist)
	m.mu.Unlock()

	log.Printf("Synced %d whitelist entries", len(whitelist))
	return nil
}

// updateWhitelist updates the local whitelist cache
func (m *Module) updateWhitelist(entries []string) {
	m.whitelist = make(map[string]bool)
	m.whitelistNets = nil

	for _, entry := range entries {
		// Try to parse as CIDR
		_, cidr, err := net.ParseCIDR(entry)
		if err == nil {
			m.whitelistNets = append(m.whitelistNets, cidr)
		} else {
			// It's a single IP
			m.whitelist[entry] = true
		}
	}

	// Also remove any banned IPs that are now whitelisted
	for ip := range m.localBans {
		if m.isWhitelisted(ip) {
			delete(m.localBans, ip)
			if m.nftables != nil {
				m.nftables.RemoveBan(ip)
			}
		}
	}
}

// syncUAPatterns fetches UA patterns from backend
func (m *Module) syncUAPatterns() error {
	httpReq, err := http.NewRequest("GET", m.config.ServerURL+"/api/agent/security/ua-patterns", nil)
	if err != nil {
		return err
	}
	httpReq.Header.Set("X-API-Key", m.config.APIKey)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("UA patterns request failed with status %d", resp.StatusCode)
	}

	var patternsResp UAPatternsResponse
	if err := json.NewDecoder(resp.Body).Decode(&patternsResp); err != nil {
		return err
	}

	m.mu.Lock()
	m.uaPatterns = patternsResp.Patterns
	m.mu.Unlock()

	log.Printf("Synced %d UA patterns", len(patternsResp.Patterns))
	return nil
}

