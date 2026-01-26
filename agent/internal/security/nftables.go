//go:build linux

package security

import (
	"bufio"
	"fmt"
	"log"
	"net"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const (
	nftTable    = "configuratix"
	nftChain    = "input"
	nftSetV4    = "banned4"
	nftSetV6    = "banned6"
	nftFamily   = "inet"
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
	mu           sync.Mutex
	enabled      bool
	ruleHandleV4 string // Handle of the IPv4 drop rule for removal
	ruleHandleV6 string // Handle of the IPv6 drop rule for removal
	lastError    string
}

// NewNftablesManager creates a new nftables manager
func NewNftablesManager() *NftablesManager {
	return &NftablesManager{
		enabled: true,
	}
}

// Init initializes the nftables table, sets, and chain
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

	// Create set for banned IPv4 addresses with timeout support
	if err := n.runNft("add set", nftFamily, nftTable, nftSetV4, "{ type ipv4_addr; flags timeout; }"); err != nil {
		if !strings.Contains(err.Error(), "File exists") {
			n.lastError = err.Error()
			return fmt.Errorf("failed to create IPv4 set: %w", err)
		}
	}

	// Create set for banned IPv6 addresses with timeout support
	if err := n.runNft("add set", nftFamily, nftTable, nftSetV6, "{ type ipv6_addr; flags timeout; }"); err != nil {
		if !strings.Contains(err.Error(), "File exists") {
			n.lastError = err.Error()
			return fmt.Errorf("failed to create IPv6 set: %w", err)
		}
	}

	// Create input chain
	if err := n.runNft("add chain", nftFamily, nftTable, nftChain, "{ type filter hook input priority 0; }"); err != nil {
		if !strings.Contains(err.Error(), "File exists") {
			n.lastError = err.Error()
			return fmt.Errorf("failed to create chain: %w", err)
		}
	}

	// Add drop rules for banned IPs (both v4 and v6)
	if err := n.ensureDropRules(); err != nil {
		n.lastError = err.Error()
		return fmt.Errorf("failed to add drop rules: %w", err)
	}

	log.Println("nftables initialized successfully (IPv4 + IPv6)")
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

// ensureDropRules ensures drop rules exist for both IPv4 and IPv6 banned sets
func (n *NftablesManager) ensureDropRules() error {
	// Check if rules already exist
	cmd := exec.Command("nft", "-a", "list", "chain", nftFamily, nftTable, nftChain)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return err
	}

	// Look for existing rules
	lines := strings.Split(string(output), "\n")
	hasV4Rule := false
	hasV6Rule := false
	for _, line := range lines {
		if strings.Contains(line, "@"+nftSetV4) && strings.Contains(line, "drop") {
			hasV4Rule = true
			parts := strings.Split(line, "# handle ")
			if len(parts) > 1 {
				n.ruleHandleV4 = strings.TrimSpace(parts[1])
			}
		}
		if strings.Contains(line, "@"+nftSetV6) && strings.Contains(line, "drop") {
			hasV6Rule = true
			parts := strings.Split(line, "# handle ")
			if len(parts) > 1 {
				n.ruleHandleV6 = strings.TrimSpace(parts[1])
			}
		}
	}

	// Add IPv4 rule if missing
	if !hasV4Rule {
		if err := n.runNft("add rule", nftFamily, nftTable, nftChain, "ip saddr @"+nftSetV4, "drop"); err != nil {
			return fmt.Errorf("failed to add IPv4 drop rule: %w", err)
		}
	}

	// Add IPv6 rule if missing
	if !hasV6Rule {
		if err := n.runNft("add rule", nftFamily, nftTable, nftChain, "ip6 saddr @"+nftSetV6, "drop"); err != nil {
			return fmt.Errorf("failed to add IPv6 drop rule: %w", err)
		}
	}

	return nil
}

// isIPv6 checks if the given IP string is an IPv6 address
func isIPv6(ip string) bool {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}
	return parsed.To4() == nil // If To4() returns nil, it's IPv6
}

// AddBan adds an IP to the appropriate banned set (v4 or v6)
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

	// Choose the right set based on IP version
	setName := nftSetV4
	if isIPv6(ip) {
		setName = nftSetV6
	}

	// Add element with timeout
	cmd := exec.Command("nft", "add", "element", nftFamily, nftTable, setName, 
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

// RemoveBan removes an IP from the appropriate banned set
func (n *NftablesManager) RemoveBan(ip string) error {
	n.mu.Lock()
	defer n.mu.Unlock()

	// Choose the right set based on IP version
	setName := nftSetV4
	if isIPv6(ip) {
		setName = nftSetV6
	}

	cmd := exec.Command("nft", "delete", "element", nftFamily, nftTable, setName,
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

// listBansFromSet returns all IPs from a specific set
func (n *NftablesManager) listBansFromSet(setName string) ([]string, error) {
	cmd := exec.Command("nft", "list", "set", nftFamily, nftTable, setName)
	output, err := cmd.CombinedOutput()
	if err != nil {
		// If set doesn't exist, return empty
		if strings.Contains(string(output), "No such file") {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to list bans from %s: %s - %s", setName, err, string(output))
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

// ListBans returns all currently banned IPs (both IPv4 and IPv6)
func (n *NftablesManager) ListBans() ([]string, error) {
	n.mu.Lock()
	defer n.mu.Unlock()

	var allIPs []string

	// Get IPv4 bans
	v4IPs, err := n.listBansFromSet(nftSetV4)
	if err != nil {
		return nil, err
	}
	allIPs = append(allIPs, v4IPs...)

	// Get IPv6 bans
	v6IPs, err := n.listBansFromSet(nftSetV6)
	if err != nil {
		return nil, err
	}
	allIPs = append(allIPs, v6IPs...)

	return allIPs, nil
}

// ClearAll removes all IPs from both banned sets
func (n *NftablesManager) ClearAll() error {
	n.mu.Lock()
	defer n.mu.Unlock()

	// Clear IPv4 set
	cmd := exec.Command("nft", "flush", "set", nftFamily, nftTable, nftSetV4)
	output, err := cmd.CombinedOutput()
	if err != nil && !strings.Contains(string(output), "No such file") {
		return fmt.Errorf("failed to clear IPv4 bans: %s - %s", err, string(output))
	}

	// Clear IPv6 set
	cmd = exec.Command("nft", "flush", "set", nftFamily, nftTable, nftSetV6)
	output, err = cmd.CombinedOutput()
	if err != nil && !strings.Contains(string(output), "No such file") {
		return fmt.Errorf("failed to clear IPv6 bans: %s - %s", err, string(output))
	}

	return nil
}

// Enable enables the drop rules
func (n *NftablesManager) Enable() error {
	n.mu.Lock()
	defer n.mu.Unlock()

	n.enabled = true
	return n.ensureDropRules()
}

// Disable disables the drop rules (bans still tracked, just not enforced)
func (n *NftablesManager) Disable() error {
	n.mu.Lock()
	defer n.mu.Unlock()

	n.enabled = false

	// Remove IPv4 drop rule
	if n.ruleHandleV4 != "" {
		cmd := exec.Command("nft", "delete", "rule", nftFamily, nftTable, nftChain, 
			"handle", n.ruleHandleV4)
		if output, err := cmd.CombinedOutput(); err != nil {
			log.Printf("Warning: failed to disable IPv4 rule: %s - %s", err, string(output))
		}
		n.ruleHandleV4 = ""
	}

	// Remove IPv6 drop rule
	if n.ruleHandleV6 != "" {
		cmd := exec.Command("nft", "delete", "rule", nftFamily, nftTable, nftChain, 
			"handle", n.ruleHandleV6)
		if output, err := cmd.CombinedOutput(); err != nil {
			log.Printf("Warning: failed to disable IPv6 rule: %s - %s", err, string(output))
		}
		n.ruleHandleV6 = ""
	}

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

	// Check IPv4 set exists and get count
	cmd = exec.Command("nft", "list", "set", nftFamily, nftTable, nftSetV4)
	output, err := cmd.CombinedOutput()
	if err == nil {
		state.SetExists = true
		// Count elements
		if strings.Contains(string(output), "elements = {") {
			count := strings.Count(string(output), ",") + 1
			state.BanCount += count
		}
	}

	// Check IPv6 set exists and add to count
	cmd = exec.Command("nft", "list", "set", nftFamily, nftTable, nftSetV6)
	output, err = cmd.CombinedOutput()
	if err == nil {
		state.SetExists = true
		if strings.Contains(string(output), "elements = {") {
			count := strings.Count(string(output), ",") + 1
			state.BanCount += count
		}
	}

	// Check rules exist
	cmd = exec.Command("nft", "-a", "list", "chain", nftFamily, nftTable, nftChain)
	output, err = cmd.CombinedOutput()
	if err == nil {
		if strings.Contains(string(output), "@"+nftSetV4) && strings.Contains(string(output), "drop") {
			state.RuleExists = true
		}
		if strings.Contains(string(output), "@"+nftSetV6) && strings.Contains(string(output), "drop") {
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

