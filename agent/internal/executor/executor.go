package executor

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

type Executor struct{}

func New() *Executor {
	return &Executor{}
}

type BootstrapPayload struct {
	SSHPort int `json:"ssh_port"`
}

type ApplyDomainPayload struct {
	Domain      string `json:"domain"`
	NginxConfig string `json:"nginx_config"`
	SSLMode     string `json:"ssl_mode"`
}

type RemoveDomainPayload struct {
	Domain string `json:"domain"`
}

func (e *Executor) Execute(jobType string, payload json.RawMessage) (string, error) {
	switch jobType {
	case "bootstrap_machine":
		var p BootstrapPayload
		json.Unmarshal(payload, &p)
		return e.bootstrapMachine(p)
	case "apply_domain":
		var p ApplyDomainPayload
		json.Unmarshal(payload, &p)
		return e.applyDomain(p)
	case "remove_domain":
		var p RemoveDomainPayload
		json.Unmarshal(payload, &p)
		return e.removeDomain(p)
	default:
		return "", fmt.Errorf("unknown job type: %s", jobType)
	}
}

func (e *Executor) bootstrapMachine(p BootstrapPayload) (string, error) {
	var logs strings.Builder

	// Update packages
	logs.WriteString("Updating packages...\n")
	if out, err := runCommand("apt-get", "update"); err != nil {
		return logs.String(), fmt.Errorf("apt update failed: %v\n%s", err, out)
	}
	logs.WriteString("Packages updated\n")

	// Install nginx
	logs.WriteString("Installing nginx...\n")
	if out, err := runCommand("apt-get", "install", "-y", "nginx"); err != nil {
		return logs.String(), fmt.Errorf("nginx install failed: %v\n%s", err, out)
	}
	logs.WriteString("Nginx installed\n")

	// Install certbot
	logs.WriteString("Installing certbot...\n")
	if out, err := runCommand("apt-get", "install", "-y", "certbot", "python3-certbot-nginx"); err != nil {
		return logs.String(), fmt.Errorf("certbot install failed: %v\n%s", err, out)
	}
	logs.WriteString("Certbot installed\n")

	// Install fail2ban
	logs.WriteString("Installing fail2ban...\n")
	if out, err := runCommand("apt-get", "install", "-y", "fail2ban"); err != nil {
		return logs.String(), fmt.Errorf("fail2ban install failed: %v\n%s", err, out)
	}
	logs.WriteString("Fail2ban installed\n")

	// Configure fail2ban for SSH
	logs.WriteString("Configuring fail2ban...\n")
	fail2banConfig := `[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 5
bantime = 3600
`
	if err := os.WriteFile("/etc/fail2ban/jail.local", []byte(fail2banConfig), 0644); err != nil {
		return logs.String(), fmt.Errorf("fail2ban config failed: %v", err)
	}
	runCommand("systemctl", "restart", "fail2ban")
	logs.WriteString("Fail2ban configured\n")

	// Enable UFW
	logs.WriteString("Configuring UFW...\n")
	runCommand("ufw", "--force", "enable")
	runCommand("ufw", "allow", "22/tcp")
	runCommand("ufw", "allow", "80/tcp")
	runCommand("ufw", "allow", "443/tcp")
	logs.WriteString("UFW configured\n")

	// Create nginx configuratix directory
	os.MkdirAll("/etc/nginx/conf.d/configuratix", 0755)
	logs.WriteString("Created nginx config directory\n")

	logs.WriteString("Bootstrap complete!\n")
	return logs.String(), nil
}

func (e *Executor) applyDomain(p ApplyDomainPayload) (string, error) {
	var logs strings.Builder

	configPath := fmt.Sprintf("/etc/nginx/conf.d/configuratix/%s.conf", p.Domain)

	// Write nginx config
	logs.WriteString(fmt.Sprintf("Writing nginx config for %s...\n", p.Domain))
	if err := os.WriteFile(configPath, []byte(p.NginxConfig), 0644); err != nil {
		return logs.String(), fmt.Errorf("failed to write nginx config: %v", err)
	}
	logs.WriteString("Nginx config written\n")

	// Test nginx config
	logs.WriteString("Testing nginx configuration...\n")
	if out, err := runCommand("nginx", "-t"); err != nil {
		// Remove invalid config
		os.Remove(configPath)
		return logs.String(), fmt.Errorf("nginx config test failed: %v\n%s", err, out)
	}
	logs.WriteString("Nginx config valid\n")

	// Reload nginx
	logs.WriteString("Reloading nginx...\n")
	if out, err := runCommand("systemctl", "reload", "nginx"); err != nil {
		return logs.String(), fmt.Errorf("nginx reload failed: %v\n%s", err, out)
	}
	logs.WriteString("Nginx reloaded\n")

	// Issue SSL certificate if needed
	if p.SSLMode != "disabled" {
		logs.WriteString(fmt.Sprintf("Issuing SSL certificate for %s...\n", p.Domain))
		out, err := runCommand("certbot", "--nginx", "-d", p.Domain, "--non-interactive", "--agree-tos", "--email", "admin@"+p.Domain, "--redirect")
		if err != nil {
			logs.WriteString(fmt.Sprintf("Warning: certbot failed (may need manual intervention): %v\n%s\n", err, out))
		} else {
			logs.WriteString("SSL certificate issued\n")
		}
	}

	logs.WriteString(fmt.Sprintf("Domain %s configured successfully!\n", p.Domain))
	return logs.String(), nil
}

func (e *Executor) removeDomain(p RemoveDomainPayload) (string, error) {
	var logs strings.Builder

	configPath := fmt.Sprintf("/etc/nginx/conf.d/configuratix/%s.conf", p.Domain)

	// Remove nginx config
	logs.WriteString(fmt.Sprintf("Removing nginx config for %s...\n", p.Domain))
	if err := os.Remove(configPath); err != nil && !os.IsNotExist(err) {
		return logs.String(), fmt.Errorf("failed to remove nginx config: %v", err)
	}
	logs.WriteString("Nginx config removed\n")

	// Reload nginx
	logs.WriteString("Reloading nginx...\n")
	if out, err := runCommand("systemctl", "reload", "nginx"); err != nil {
		return logs.String(), fmt.Errorf("nginx reload failed: %v\n%s", err, out)
	}
	logs.WriteString("Nginx reloaded\n")

	logs.WriteString(fmt.Sprintf("Domain %s removed successfully!\n", p.Domain))
	return logs.String(), nil
}

func runCommand(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	output := stdout.String() + stderr.String()
	return output, err
}

