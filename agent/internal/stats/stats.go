//go:build linux || darwin
// +build linux darwin

package stats

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"syscall"
)

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

// Collect gathers all system statistics
func Collect(version string) Stats {
	stats := Stats{Version: version}

	// CPU - simple load average based
	if data, err := os.ReadFile("/proc/loadavg"); err == nil {
		parts := strings.Fields(string(data))
		if len(parts) > 0 {
			if load, err := strconv.ParseFloat(parts[0], 64); err == nil {
				if cpus := getCPUCount(); cpus > 0 {
					stats.CPUPercent = (load / float64(cpus)) * 100
					if stats.CPUPercent > 100 {
						stats.CPUPercent = 100
					}
				}
			}
		}
	}

	// Memory
	if data, err := os.ReadFile("/proc/meminfo"); err == nil {
		lines := strings.Split(string(data), "\n")
		var total, available int64
		for _, line := range lines {
			if strings.HasPrefix(line, "MemTotal:") {
				fmt.Sscanf(line, "MemTotal: %d kB", &total)
				total *= 1024
			} else if strings.HasPrefix(line, "MemAvailable:") {
				fmt.Sscanf(line, "MemAvailable: %d kB", &available)
				available *= 1024
			}
		}
		stats.MemoryTotal = total
		stats.MemoryUsed = total - available
	}

	// Disk
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err == nil {
		stats.DiskTotal = int64(stat.Blocks) * int64(stat.Bsize)
		stats.DiskUsed = stats.DiskTotal - int64(stat.Bfree)*int64(stat.Bsize)
	}

	// SSH Port
	stats.SSHPort = getSSHPort()

	// UFW status and rules
	if out, err := exec.Command("ufw", "status").Output(); err == nil {
		outStr := string(out)
		stats.UFWEnabled = strings.Contains(outStr, "Status: active")
		stats.UFWRules = parseUFWRules(outStr)
	}

	// Fail2ban status
	if out, err := exec.Command("systemctl", "is-active", "fail2ban").Output(); err == nil {
		stats.Fail2ban = strings.TrimSpace(string(out)) == "active"
	}

	// Detected IPs from all interfaces
	stats.DetectedIPs = getInterfaceIPs()

	return stats
}

func getCPUCount() int {
	if data, err := os.ReadFile("/proc/cpuinfo"); err == nil {
		return strings.Count(string(data), "processor")
	}
	return 1
}

func getSSHPort() int {
	paths := []string{"/etc/ssh/sshd_config"}
	for _, path := range paths {
		if data, err := os.ReadFile(path); err == nil {
			re := regexp.MustCompile(`(?m)^Port\s+(\d+)`)
			if matches := re.FindStringSubmatch(string(data)); len(matches) > 1 {
				if port, err := strconv.Atoi(matches[1]); err == nil {
					return port
				}
			}
		}
	}
	return 22
}

func parseUFWRules(output string) []UFWRule {
	var rules []UFWRule
	lines := strings.Split(output, "\n")
	inRules := false

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Skip header lines until we find the dashed separator
		if strings.HasPrefix(line, "--") {
			inRules = true
			continue
		}
		if !inRules {
			continue
		}

		// Parse rule line: "80/tcp                     ALLOW       Anywhere"
		parts := strings.Fields(line)
		if len(parts) < 3 {
			continue
		}

		portProto := parts[0]
		action := parts[1]
		from := "Anywhere"
		if len(parts) >= 3 {
			from = strings.Join(parts[2:], " ")
		}

		// Skip IPv6 duplicates for cleaner display
		if strings.Contains(portProto, "(v6)") {
			continue
		}

		// Parse port/protocol
		portProto = strings.TrimSuffix(portProto, "(v6)")
		portProto = strings.TrimSpace(portProto)

		port := portProto
		protocol := "tcp"
		if strings.Contains(portProto, "/") {
			pp := strings.Split(portProto, "/")
			port = pp[0]
			if len(pp) > 1 {
				protocol = pp[1]
			}
		}

		rules = append(rules, UFWRule{
			Port:     port,
			Protocol: protocol,
			Action:   action,
			From:     from,
		})
	}
	return rules
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

	// Check for private IP ranges
	// 10.0.0.0/8
	if ip[0] == 10 {
		return false
	}
	// 172.16.0.0/12
	if ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31 {
		return false
	}
	// 192.168.0.0/16
	if ip[0] == 192 && ip[1] == 168 {
		return false
	}
	// 100.64.0.0/10 (Carrier-grade NAT)
	if ip[0] == 100 && ip[1] >= 64 && ip[1] <= 127 {
		return false
	}
	// 169.254.0.0/16 (Link-local)
	if ip[0] == 169 && ip[1] == 254 {
		return false
	}

	return true
}

