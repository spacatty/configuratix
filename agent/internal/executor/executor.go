package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Executor struct {
	serverURL string
	apiKey    string
	client    *http.Client
}

func New() *Executor {
	return &Executor{
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

// SetConfig sets server URL and API key for deploy_landing
func (e *Executor) SetConfig(serverURL, apiKey string) {
	e.serverURL = serverURL
	e.apiKey = apiKey
}

// Step represents a single operation in a run job
type Step struct {
	Action  string `json:"action"` // exec, file, service, fetch
	Command string `json:"command"`
	Timeout int    `json:"timeout"` // seconds, default 300
	Path    string `json:"path"`
	Content string `json:"content"`
	URL     string `json:"url"`
	Mode    string `json:"mode"`
	Op      string `json:"op"` // write, append, delete, backup
	Name    string `json:"name"`
	Log     string `json:"log"`
}

// RunPayload is the unified job type for complex operations
type RunPayload struct {
	Steps   []Step            `json:"steps"`
	OnError string            `json:"on_error"` // stop (default), continue, rollback
	Vars    map[string]string `json:"vars"`
}

// DeployLandingPayload for static content deployment
type DeployLandingPayload struct {
	LandingID      string `json:"landing_id"`
	TargetPath     string `json:"target_path"`
	IndexFile      string `json:"index_file"`
	UsePHP         bool   `json:"use_php"`
	ReplaceContent *bool  `json:"replace_content"`
}

func (e *Executor) Execute(jobType string, payload json.RawMessage) (string, error) {
	switch jobType {
	case "run":
		var p RunPayload
		json.Unmarshal(payload, &p)
		return e.executeRun(p)

	case "deploy_landing":
		var p DeployLandingPayload
		json.Unmarshal(payload, &p)
		replaceContent := p.ReplaceContent == nil || *p.ReplaceContent
		return e.deployLanding(p.LandingID, p.TargetPath, p.IndexFile, replaceContent)

	case "update_agent":
		// Manual update trigger
		return e.updateAgent()

	// Legacy job types for backwards compatibility
	case "exec":
		var p struct {
			Command string `json:"command"`
			Script  string `json:"script"`
			Timeout int    `json:"timeout"`
		}
		json.Unmarshal(payload, &p)
		cmd := p.Command
		if cmd == "" {
			cmd = p.Script
		}
		return execWithTimeout(cmd, p.Timeout)

	case "file":
		var p struct {
			Action  string `json:"action"`
			Path    string `json:"path"`
			Content string `json:"content"`
			Mode    string `json:"mode"`
		}
		json.Unmarshal(payload, &p)
		out, err, _ := fileOpSafe(Step{Action: "file", Op: p.Action, Path: p.Path, Content: p.Content, Mode: p.Mode}, nil)
		return out, err

	case "service":
		var p struct {
			Name   string `json:"name"`
			Action string `json:"action"`
		}
		json.Unmarshal(payload, &p)
		return serviceOp(p.Name, p.Action)

	case "bootstrap_machine":
		return e.bootstrap()

	case "apply_domain":
		var p struct {
			Domain      string `json:"domain"`
			NginxConfig string `json:"nginx_config"`
			SSLMode     string `json:"ssl_mode"`
		}
		json.Unmarshal(payload, &p)
		return e.applyDomain(p.Domain, p.NginxConfig, p.SSLMode)

	case "remove_domain":
		var p struct {
			Domain string `json:"domain"`
		}
		json.Unmarshal(payload, &p)
		return e.removeDomain(p.Domain)

	default:
		return "", fmt.Errorf("unknown job type: %s", jobType)
	}
}

// executeRun processes a run job with multiple steps
func (e *Executor) executeRun(payload RunPayload) (string, error) {
	var logs strings.Builder
	var backups []string

	onError := payload.OnError
	if onError == "" {
		onError = "stop"
	}

	for i, step := range payload.Steps {
		logs.WriteString(fmt.Sprintf("\n=== Step %d: %s ===\n", i+1, step.Action))

		// Variable substitution
		step = substituteVars(step, payload.Vars)

		var stepLog string
		var err error

		switch step.Action {
		case "exec":
			stepLog, err = execWithTimeout(step.Command, step.Timeout)
		case "file":
			stepLog, err, backups = fileOpSafe(step, backups)
		case "service":
			stepLog, err = serviceOp(step.Name, step.Op)
		case "fetch":
			stepLog, err = fetchToFile(step.URL, step.Path, step.Mode)
		default:
			err = fmt.Errorf("unknown action: %s", step.Action)
		}

		logs.WriteString(stepLog)

		// Handle custom logging
		if step.Log != "" && step.Log != "out" {
			logs.WriteString("\n--- Log output ---\n")
			logOutput, logErr := execWithTimeout(step.Log, 30)
			logs.WriteString(logOutput)
			if logErr != nil {
				logs.WriteString(fmt.Sprintf("(log command failed: %v)\n", logErr))
			}
		}

		if err != nil {
			logs.WriteString(fmt.Sprintf("ERROR: %v\n", err))

			if onError == "rollback" {
				logs.WriteString("\n=== Rolling back ===\n")
				rollbackLog := rollback(backups)
				logs.WriteString(rollbackLog)
			}

			if onError != "continue" {
				return logs.String(), err
			}
		}
	}

	logs.WriteString("\n=== All steps completed ===\n")
	return logs.String(), nil
}

// substituteVars replaces {{var}} with values
func substituteVars(step Step, vars map[string]string) Step {
	for k, v := range vars {
		placeholder := "{{" + k + "}}"
		step.Command = strings.ReplaceAll(step.Command, placeholder, v)
		step.Path = strings.ReplaceAll(step.Path, placeholder, v)
		step.Content = strings.ReplaceAll(step.Content, placeholder, v)
		step.URL = strings.ReplaceAll(step.URL, placeholder, v)
		step.Name = strings.ReplaceAll(step.Name, placeholder, v)
		step.Log = strings.ReplaceAll(step.Log, placeholder, v)
	}
	return step
}

// execWithTimeout runs a command with timeout
func execWithTimeout(cmdStr string, timeoutSec int) (string, error) {
	var logs strings.Builder
	logs.WriteString("$ " + cmdStr + "\n")

	if timeoutSec <= 0 {
		timeoutSec = 300
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "/bin/bash", "-c", cmdStr)
	out, err := cmd.CombinedOutput()
	logs.WriteString(string(out))

	if ctx.Err() == context.DeadlineExceeded {
		return logs.String(), fmt.Errorf("command timed out after %ds", timeoutSec)
	}

	return logs.String(), err
}

// fileOpSafe performs file operations with backup support
func fileOpSafe(step Step, backups []string) (string, error, []string) {
	var logs strings.Builder
	path := step.Path
	op := step.Op
	if op == "" {
		op = "write"
	}

	// Fetch content from URL if specified
	content := step.Content
	if step.URL != "" {
		logs.WriteString(fmt.Sprintf("Fetching content from %s...\n", step.URL))
		resp, err := http.Get(step.URL)
		if err != nil {
			return logs.String(), err, backups
		}
		defer resp.Body.Close()
		data, err := io.ReadAll(resp.Body)
		if err != nil {
			return logs.String(), err, backups
		}
		content = string(data)
		logs.WriteString(fmt.Sprintf("Fetched %d bytes\n", len(data)))
	}

	switch op {
	case "write":
		// Backup existing file for rollback
		if _, err := os.Stat(path); err == nil {
			backupPath := path + ".configuratix-backup"
			if data, err := os.ReadFile(path); err == nil {
				os.WriteFile(backupPath, data, 0644)
				backups = append(backups, backupPath+":"+path)
				logs.WriteString(fmt.Sprintf("Backed up to %s\n", backupPath))
			}
		}

		logs.WriteString(fmt.Sprintf("Writing to %s (%d bytes)...\n", path, len(content)))
		os.MkdirAll(filepath.Dir(path), 0755)
		perm := os.FileMode(0644)
		if step.Mode != "" {
			if m, err := strconv.ParseUint(step.Mode, 8, 32); err == nil {
				perm = os.FileMode(m)
			}
		}
		if err := os.WriteFile(path, []byte(content), perm); err != nil {
			return logs.String(), err, backups
		}
		logs.WriteString("Done\n")

	case "append":
		logs.WriteString(fmt.Sprintf("Appending to %s...\n", path))
		f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			return logs.String(), err, backups
		}
		defer f.Close()
		f.WriteString(content)
		logs.WriteString("Done\n")

	case "delete":
		if data, err := os.ReadFile(path); err == nil {
			backupPath := path + ".configuratix-backup"
			os.WriteFile(backupPath, data, 0644)
			backups = append(backups, backupPath+":"+path)
		}
		logs.WriteString(fmt.Sprintf("Deleting %s...\n", path))
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return logs.String(), err, backups
		}
		logs.WriteString("Done\n")

	case "backup":
		backupPath := path + ".configuratix-backup"
		logs.WriteString(fmt.Sprintf("Backing up %s to %s...\n", path, backupPath))
		if data, err := os.ReadFile(path); err == nil {
			os.WriteFile(backupPath, data, 0644)
			logs.WriteString("Done\n")
		} else {
			logs.WriteString("File not found, skipped\n")
		}

	default:
		return logs.String(), fmt.Errorf("unknown file op: %s", op), backups
	}

	return logs.String(), nil, backups
}

// fetchToFile downloads a URL to a file
func fetchToFile(url, path, mode string) (string, error) {
	var logs strings.Builder
	logs.WriteString(fmt.Sprintf("Fetching %s -> %s\n", url, path))

	resp, err := http.Get(url)
	if err != nil {
		return logs.String(), err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return logs.String(), fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	os.MkdirAll(filepath.Dir(path), 0755)
	perm := os.FileMode(0644)
	if mode != "" {
		if m, err := strconv.ParseUint(mode, 8, 32); err == nil {
			perm = os.FileMode(m)
		}
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return logs.String(), err
	}

	if err := os.WriteFile(path, data, perm); err != nil {
		return logs.String(), err
	}

	logs.WriteString(fmt.Sprintf("Downloaded %d bytes\n", len(data)))
	return logs.String(), nil
}

// rollback restores backed up files
func rollback(backups []string) string {
	var logs strings.Builder
	for _, b := range backups {
		parts := strings.SplitN(b, ":", 2)
		if len(parts) != 2 {
			continue
		}
		backupPath, originalPath := parts[0], parts[1]

		if data, err := os.ReadFile(backupPath); err == nil {
			os.WriteFile(originalPath, data, 0644)
			os.Remove(backupPath)
			logs.WriteString(fmt.Sprintf("Restored %s\n", originalPath))
		}
	}
	return logs.String()
}

// serviceOp manages systemd services
func serviceOp(name, action string) (string, error) {
	var logs strings.Builder
	if action == "" {
		action = "restart"
	}
	logs.WriteString(fmt.Sprintf("Service %s: %s...\n", name, action))

	validActions := map[string]bool{
		"start": true, "stop": true, "restart": true,
		"reload": true, "enable": true, "disable": true, "status": true,
	}
	if !validActions[action] {
		return logs.String(), fmt.Errorf("invalid service action: %s", action)
	}

	out, err := runCommand("systemctl", action, name)
	logs.WriteString(out)

	return logs.String(), err
}

// bootstrap installs base packages
func (e *Executor) bootstrap() (string, error) {
	var logs strings.Builder
	logs.WriteString("Bootstrapping machine...\n")
	runCommand("apt-get", "update")
	out, _ := runCommand("apt-get", "install", "-y", "nginx", "certbot", "python3-certbot-nginx", "fail2ban", "ufw", "unzip")
	logs.WriteString(out)
	os.MkdirAll("/etc/nginx/conf.d/configuratix", 0755)
	runCommand("systemctl", "enable", "nginx")
	runCommand("systemctl", "start", "nginx")
	runCommand("systemctl", "enable", "fail2ban")
	runCommand("systemctl", "start", "fail2ban")
	logs.WriteString("Bootstrap complete\n")
	return logs.String(), nil
}

// applyDomain configures nginx for a domain
func (e *Executor) applyDomain(domain, nginxConfig, sslMode string) (string, error) {
	var logs strings.Builder

	configPath := fmt.Sprintf("/etc/nginx/conf.d/configuratix/%s.conf", domain)

	logs.WriteString(fmt.Sprintf("Writing nginx config for %s...\n", domain))
	if err := os.WriteFile(configPath, []byte(nginxConfig), 0644); err != nil {
		return logs.String(), fmt.Errorf("failed to write nginx config: %v", err)
	}
	logs.WriteString("Nginx config written\n")

	logs.WriteString("Testing nginx configuration...\n")
	if out, err := runCommand("nginx", "-t"); err != nil {
		os.Remove(configPath)
		return logs.String(), fmt.Errorf("nginx config test failed: %v\n%s", err, out)
	}
	logs.WriteString("Nginx config valid\n")

	logs.WriteString("Reloading nginx...\n")
	if out, err := runCommand("systemctl", "reload", "nginx"); err != nil {
		return logs.String(), fmt.Errorf("nginx reload failed: %v\n%s", err, out)
	}
	logs.WriteString("Nginx reloaded\n")

	if sslMode != "disabled" && sslMode != "" {
		logs.WriteString(fmt.Sprintf("Issuing SSL certificate for %s...\n", domain))
		out, err := runCommand("certbot", "--nginx", "-d", domain, "--non-interactive", "--agree-tos", "--email", "admin@"+domain, "--redirect")
		if err != nil {
			logs.WriteString(fmt.Sprintf("Warning: certbot failed: %v\n%s\n", err, out))
		} else {
			logs.WriteString("SSL certificate issued\n")
		}
	}

	logs.WriteString(fmt.Sprintf("Domain %s configured successfully!\n", domain))
	return logs.String(), nil
}

// removeDomain removes nginx config for a domain
func (e *Executor) removeDomain(domain string) (string, error) {
	var logs strings.Builder

	configPath := fmt.Sprintf("/etc/nginx/conf.d/configuratix/%s.conf", domain)

	logs.WriteString(fmt.Sprintf("Removing nginx config for %s...\n", domain))
	if err := os.Remove(configPath); err != nil && !os.IsNotExist(err) {
		return logs.String(), fmt.Errorf("failed to remove nginx config: %v", err)
	}
	logs.WriteString("Nginx config removed\n")

	logs.WriteString("Reloading nginx...\n")
	if out, err := runCommand("systemctl", "reload", "nginx"); err != nil {
		return logs.String(), fmt.Errorf("nginx reload failed: %v\n%s", err, out)
	}
	logs.WriteString("Nginx reloaded\n")

	logs.WriteString(fmt.Sprintf("Domain %s removed successfully!\n", domain))
	return logs.String(), nil
}

// deployLanding deploys static content
func (e *Executor) deployLanding(landingID, targetPath, indexFile string, replaceContent bool) (string, error) {
	var logs strings.Builder

	if e.serverURL == "" {
		return "", fmt.Errorf("server URL not configured")
	}

	downloadURL := e.serverURL + "/api/agent/static/" + landingID + "/download"
	logs.WriteString(fmt.Sprintf("Downloading from %s...\n", downloadURL))

	req, _ := http.NewRequest("GET", downloadURL, nil)
	req.Header.Set("X-API-Key", e.apiKey)
	resp, err := e.client.Do(req)
	if err != nil {
		return logs.String(), err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return logs.String(), fmt.Errorf("download failed: HTTP %d", resp.StatusCode)
	}

	// Save to temp file
	tmpFile := "/tmp/landing-" + landingID + ".zip"
	data, _ := io.ReadAll(resp.Body)
	if err := os.WriteFile(tmpFile, data, 0644); err != nil {
		return logs.String(), err
	}
	logs.WriteString(fmt.Sprintf("Downloaded %d bytes\n", len(data)))

	// Handle directory
	if replaceContent {
		os.RemoveAll(targetPath)
	}
	os.MkdirAll(targetPath, 0755)

	// Unzip
	logs.WriteString("Extracting...\n")
	out, err := runCommand("unzip", "-o", tmpFile, "-d", targetPath)
	logs.WriteString(out)
	os.Remove(tmpFile)

	if err != nil {
		return logs.String(), err
	}

	logs.WriteString(fmt.Sprintf("Deployed to %s\n", targetPath))
	return logs.String(), nil
}

// updateAgent triggers a manual agent update
func (e *Executor) updateAgent() (string, error) {
	// Import updater package dynamically to avoid circular imports
	// The actual update is triggered via the updater singleton
	return "Agent update triggered. Check agent logs for status.", nil
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
