//go:build windows
// +build windows

package stats

import "net"

// InterfaceIP represents an IP address on an interface
type InterfaceIP struct {
	Interface string `json:"interface"`
	IP        string `json:"ip"`
	IsPublic  bool   `json:"is_public"`
	IsIPv6    bool   `json:"is_ipv6"`
}

// Stats contains system statistics
type Stats struct {
	Version     string        `json:"version"`
	CPUPercent  float64       `json:"cpu_percent"`
	MemoryUsed  int64         `json:"memory_used"`
	MemoryTotal int64         `json:"memory_total"`
	DiskUsed    int64         `json:"disk_used"`
	DiskTotal   int64         `json:"disk_total"`
	SSHPort     int           `json:"ssh_port"`
	UFWEnabled  bool          `json:"ufw_enabled"`
	UFWRules    []UFWRule     `json:"ufw_rules"`
	Fail2ban    bool          `json:"fail2ban_enabled"`
	DetectedIPs []InterfaceIP `json:"detected_ips"`
}

// UFWRule represents a firewall rule
type UFWRule struct {
	Port     string `json:"port"`
	Protocol string `json:"protocol"`
	Action   string `json:"action"`
	From     string `json:"from"`
}

// Collect gathers all system statistics for Windows
func Collect(version string) Stats {
	stats := Stats{Version: version}
	stats.DetectedIPs = getInterfaceIPs()
	return stats
}

// getInterfaceIPs detects all IP addresses on all network interfaces
func getInterfaceIPs() []InterfaceIP {
	var ips []InterfaceIP

	interfaces, err := net.Interfaces()
	if err != nil {
		return ips
	}

	for _, iface := range interfaces {
		// Skip loopback and down interfaces
		if iface.Flags&net.FlagLoopback != 0 || iface.Flags&net.FlagUp == 0 {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			var ip net.IP

			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}

			if ip == nil {
				continue
			}

			// Skip link-local addresses
			if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
				continue
			}

			isIPv6 := ip.To4() == nil
			isPublic := isPublicIP(ip)

			ips = append(ips, InterfaceIP{
				Interface: iface.Name,
				IP:        ip.String(),
				IsPublic:  isPublic,
				IsIPv6:    isIPv6,
			})
		}
	}

	return ips
}

// isPublicIP checks if an IP is a public (non-private, non-local) address
func isPublicIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return false
	}

	ip4 := ip.To4()
	if ip4 == nil {
		// IPv6 - check for private ranges
		return !ip.IsPrivate()
	}

	// Check for private IP ranges
	// 10.0.0.0/8
	if ip4[0] == 10 {
		return false
	}
	// 172.16.0.0/12
	if ip4[0] == 172 && ip4[1] >= 16 && ip4[1] <= 31 {
		return false
	}
	// 192.168.0.0/16
	if ip4[0] == 192 && ip4[1] == 168 {
		return false
	}
	// 100.64.0.0/10 (Carrier-grade NAT)
	if ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
		return false
	}
	// 169.254.0.0/16 (Link-local)
	if ip4[0] == 169 && ip4[1] == 254 {
		return false
	}

	return true
}

