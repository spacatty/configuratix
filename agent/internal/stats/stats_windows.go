//go:build windows
// +build windows

package stats

// Stats contains system statistics
type Stats struct {
	Version     string    `json:"version"`
	CPUPercent  float64   `json:"cpu_percent"`
	MemoryUsed  int64     `json:"memory_used"`
	MemoryTotal int64     `json:"memory_total"`
	DiskUsed    int64     `json:"disk_used"`
	DiskTotal   int64     `json:"disk_total"`
	SSHPort     int       `json:"ssh_port"`
	UFWEnabled  bool      `json:"ufw_enabled"`
	UFWRules    []UFWRule `json:"ufw_rules"`
	Fail2ban    bool      `json:"fail2ban_enabled"`
}

// UFWRule represents a firewall rule
type UFWRule struct {
	Port     string `json:"port"`
	Protocol string `json:"protocol"`
	Action   string `json:"action"`
	From     string `json:"from"`
}

// Collect gathers all system statistics (stub for Windows)
func Collect(version string) Stats {
	return Stats{Version: version}
}

