// +build linux

package security

import (
	"bufio"
	"fmt"
	"log"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const (
	nftTable   = "configuratix"
	nftChain   = "input"
	nftSet     = "banned"
	nftFamily  = "inet"
)

// NftablesState represents the current state
type NftablesState struct {
	Enabled     bool      `json:"enabled"`
	BanCount    int       `json:"ban_count"`
	TableExists bool      `json:"table_exists"`
	SetExists   bool      `json:"set_exists"`
	RuleExists  bool      `json:"rule_exists"`
	LastError   string    `json:"last_error,omitempty"`
	CheckedAt   time.Time `json:"checked_at"`
}

// NftablesManager manages nftables rules for IP banning
type NftablesManager struct {
	mu         sync.Mutex
	enabled    bool
	ruleHandle string // Handle of the drop rule for removal
	lastError  string
}

// NewNftablesManager creates a new nftables manager
func NewNftablesManager() *NftablesManager {
	return &NftablesManager{
		enabled: true,
	}
}

// Init initializes the nftables table, set, and chain
func (n *NftablesManager) Init() error {
	n.mu.Lock()
	defer n.mu.Unlock()

	// Create table if not exists
	if err := n.runNft("add table", nftFamily, nftTable); err != nil {
		// Ignore "table already exists" error
		if !strings.Contains(err.Error(), "File exists") {
			n.lastError = err.Error()
			return fmt.Errorf("failed to create table: %w", err)
		}
	}

	// Create set for banned IPs with timeout support
	if err := n.runNft("add set", nftFamily, nftTable, nftSet, "{ type ipv4_addr; flags timeout; }"); err != nil {
		if !strings.Contains(err.Error(), "File exists") {
			n.lastError = err.Error()
			return fmt.Errorf("failed to create set: %w", err)
		}
	}

	// Create input chain
	if err := n.runNft("add chain", nftFamily, nftTable, nftChain, "{ type filter hook input priority 0; }"); err != nil {
		if !strings.Contains(err.Error(), "File exists") {
			n.lastError = err.Error()
			return fmt.Errorf("failed to create chain: %w", err)
		}
	}

	// Add drop rule for banned IPs
	if err := n.ensureDropRule(); err != nil {
		n.lastError = err.Error()
		return fmt.Errorf("failed to add drop rule: %w", err)
	}

	log.Println("nftables initialized successfully")
	return nil
}

// runNft executes an nft command
func (n *NftablesManager) runNft(action string, args ...string) error {
	cmdArgs := strings.Split(action, " ")
	cmdArgs = append(cmdArgs, args...)
	
	cmd := exec.Command("nft", cmdArgs...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %s", err, string(output))
	}
	return nil
}

// ensureDropRule ensures the drop rule exists for the banned set
func (n *NftablesManager) ensureDropRule() error {
	// Check if rule already exists
	cmd := exec.Command("nft", "-a", "list", "chain", nftFamily, nftTable, nftChain)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return err
	}

	// Look for existing rule
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		if strings.Contains(line, "@"+nftSet) && strings.Contains(line, "drop") {
			// Rule exists, extract handle
			parts := strings.Split(line, "# handle ")
			if len(parts) > 1 {
				n.ruleHandle = strings.TrimSpace(parts[1])
			}
			return nil
		}
	}

	// Add rule: drop packets from banned IPs
	return n.runNft("add rule", nftFamily, nftTable, nftChain, "ip saddr @"+nftSet, "drop")
}

// AddBan adds an IP to the banned set
func (n *NftablesManager) AddBan(ip string, expiresAt time.Time) error {
	n.mu.Lock()
	defer n.mu.Unlock()

	if !n.enabled {
		return nil
	}

	// Calculate timeout
	timeout := time.Until(expiresAt)
	if timeout <= 0 {
		return nil // Already expired
	}

	// Format timeout for nftables (e.g., "30d" or "720h")
	timeoutStr := fmt.Sprintf("%ds", int(timeout.Seconds()))
	if timeout.Hours() >= 24 {
		timeoutStr = fmt.Sprintf("%dd", int(timeout.Hours()/24))
	}

	// Add element with timeout
	cmd := exec.Command("nft", "add", "element", nftFamily, nftTable, nftSet, 
		fmt.Sprintf("{ %s timeout %s }", ip, timeoutStr))
	output, err := cmd.CombinedOutput()
	if err != nil {
		// Ignore "element already exists" error
		if !strings.Contains(string(output), "exists") {
			return fmt.Errorf("failed to add ban: %s - %s", err, string(output))
		}
	}
	return nil
}

// RemoveBan removes an IP from the banned set
func (n *NftablesManager) RemoveBan(ip string) error {
	n.mu.Lock()
	defer n.mu.Unlock()

	cmd := exec.Command("nft", "delete", "element", nftFamily, nftTable, nftSet,
		fmt.Sprintf("{ %s }", ip))
	output, err := cmd.CombinedOutput()
	if err != nil {
		// Ignore "element does not exist" error
		if !strings.Contains(string(output), "No such file") {
			return fmt.Errorf("failed to remove ban: %s - %s", err, string(output))
		}
	}
	return nil
}

// ListBans returns all currently banned IPs
func (n *NftablesManager) ListBans() ([]string, error) {
	n.mu.Lock()
	defer n.mu.Unlock()

	cmd := exec.Command("nft", "list", "set", nftFamily, nftTable, nftSet)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("failed to list bans: %s - %s", err, string(output))
	}

	var ips []string
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	inElements := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "elements = {") {
			inElements = true
			// Parse inline elements if on same line
			if idx := strings.Index(line, "{"); idx >= 0 {
				elemPart := line[idx+1:]
				if endIdx := strings.Index(elemPart, "}"); endIdx >= 0 {
					elemPart = elemPart[:endIdx]
				}
				for _, elem := range strings.Split(elemPart, ",") {
					elem = strings.TrimSpace(elem)
					if elem != "" {
						// Extract IP (may have timeout suffix)
						parts := strings.Fields(elem)
						if len(parts) > 0 {
							ips = append(ips, parts[0])
						}
					}
				}
			}
		} else if inElements {
			if strings.HasPrefix(line, "}") {
				break
			}
			// Parse element line
			for _, elem := range strings.Split(line, ",") {
				elem = strings.TrimSpace(elem)
				if elem != "" && elem != "}" {
					parts := strings.Fields(elem)
					if len(parts) > 0 {
						ips = append(ips, parts[0])
					}
				}
			}
		}
	}

	return ips, nil
}

// ClearAll removes all IPs from the banned set
func (n *NftablesManager) ClearAll() error {
	n.mu.Lock()
	defer n.mu.Unlock()

	cmd := exec.Command("nft", "flush", "set", nftFamily, nftTable, nftSet)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to clear bans: %s - %s", err, string(output))
	}
	return nil
}

// Enable enables the drop rule
func (n *NftablesManager) Enable() error {
	n.mu.Lock()
	defer n.mu.Unlock()

	n.enabled = true
	return n.ensureDropRule()
}

// Disable disables the drop rule (bans still tracked, just not enforced)
func (n *NftablesManager) Disable() error {
	n.mu.Lock()
	defer n.mu.Unlock()

	n.enabled = false

	if n.ruleHandle == "" {
		return nil
	}

	// Remove the drop rule
	cmd := exec.Command("nft", "delete", "rule", nftFamily, nftTable, nftChain, 
		"handle", n.ruleHandle)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to disable: %s - %s", err, string(output))
	}
	n.ruleHandle = ""
	return nil
}

// GetState returns the current nftables state
func (n *NftablesManager) GetState() *NftablesState {
	n.mu.Lock()
	defer n.mu.Unlock()

	state := &NftablesState{
		Enabled:   n.enabled,
		CheckedAt: time.Now(),
		LastError: n.lastError,
	}

	// Check table exists
	cmd := exec.Command("nft", "list", "table", nftFamily, nftTable)
	if err := cmd.Run(); err == nil {
		state.TableExists = true
	}

	// Check set exists and get count
	cmd = exec.Command("nft", "list", "set", nftFamily, nftTable, nftSet)
	output, err := cmd.CombinedOutput()
	if err == nil {
		state.SetExists = true
		// Count elements
		count := strings.Count(string(output), ",") + 1
		if strings.Contains(string(output), "elements = {") {
			state.BanCount = count
		}
	}

	// Check rule exists
	cmd = exec.Command("nft", "-a", "list", "chain", nftFamily, nftTable, nftChain)
	output, err = cmd.CombinedOutput()
	if err == nil {
		if strings.Contains(string(output), "@"+nftSet) && strings.Contains(string(output), "drop") {
			state.RuleExists = true
		}
	}

	return state
}

// IsEnabled returns whether nftables enforcement is enabled
func (n *NftablesManager) IsEnabled() bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.enabled
}

