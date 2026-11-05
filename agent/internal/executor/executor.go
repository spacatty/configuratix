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
	"strings"
	"time"

	"configuratix/agent/internal/updater"
)

type Executor struct {
	serverURL string
	apiKey    string
	version   string
	client    *http.Client
}

func New() *Executor {
	return &Executor{
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

// SetConfig sets server URL and API key for deploy_landing / update_agent
func (e *Executor) SetConfig(serverURL, apiKey string) {
	e.serverURL = serverURL
	e.apiKey = apiKey
}

// SetVersion sets the running agent version (used by update_agent).
func (e *Executor) SetVersion(v string) { e.version = v }

// DeployLandingPayload for static content deployment
type DeployLandingPayload struct {
	LandingID      string `json:"landing_id"`
	TargetPath     string `json:"target_path"`
	IndexFile      string `json:"index_file"`
	UsePHP         bool   `json:"use_php"`
	ReplaceContent *bool  `json:"replace_content"`
}

// Execute runs a job synchronously and returns its full log (v1 API).
func (e *Executor) Execute(jobType string, payload json.RawMessage) (string, error) {
	var buf bytes.Buffer
	_, err := e.Run(context.Background(), "", jobType, payload, &buf)
	return buf.String(), err
}

// Run executes a job. Logs are streamed to out as they are produced. ctx
// cancellation (job cancel / job timeout) kills the running step's process
// group. The returned Result is never nil.
func (e *Executor) Run(ctx context.Context, jobID, jobType string, payload json.RawMessage, out io.Writer) (*Result, error) {
	res := newResult(jobType)
	start := time.Now()
	err := e.dispatch(ctx, jobID, jobType, payload, out, res)
	res.DurationMs = time.Since(start).Milliseconds()
	if err != nil {
		res.Error = err.Error()
	}
	return res, err
}

func (e *Executor) dispatch(ctx context.Context, jobID, jobType string, payload json.RawMessage, out io.Writer, res *Result) error {
	// legacy helpers return their whole log at the end
	legacy := func(logs string, err error) error {
		io.WriteString(out, logs)
		return err
	}

	switch jobType {
	case "run":
		var p RunPayload
		json.Unmarshal(payload, &p)
		return e.executeRun(ctx, p, out, res)

	case "deploy_landing":
		var p DeployLandingPayload
		json.Unmarshal(payload, &p)
		replaceContent := p.ReplaceContent == nil || *p.ReplaceContent
		return legacy(e.deployLanding(p.LandingID, p.TargetPath, p.IndexFile, replaceContent))

	case "update_agent":
		var p struct {
			TargetVersion string `json:"target_version"`
		}
		json.Unmarshal(payload, &p)
		u := updater.New(e.serverURL, e.version)
		u.SetAPIKey(e.apiKey)
		info, after, err := u.Apply(ctx, jobID, p.TargetVersion, out)
		if info != nil {
			res.Data, _ = json.Marshal(info)
		}
		res.After = after
		return err

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
		fmt.Fprintf(out, "$ %s\n", cmd)
		_, err := runProcess(ctx, []string{"/bin/bash", "-c", cmd}, nil, p.Timeout, out, false)
		return err

	case "file":
		var p struct {
			Action  string `json:"action"`
			Path    string `json:"path"`
			Content string `json:"content"`
			Mode    string `json:"mode"`
		}
		json.Unmarshal(payload, &p)
		rc := &runCtx{ctx: ctx}
		return rc.fileOp(Step{Action: "file", Op: p.Action, Path: p.Path, Content: p.Content, Mode: p.Mode}, out)

	case "service":
		var p struct {
			Name   string `json:"name"`
			Action string `json:"action"`
		}
		json.Unmarshal(payload, &p)
		return legacy(serviceOp(ctx, p.Name, p.Action))

	case "bootstrap_machine":
		return legacy(e.bootstrap())

	case "apply_domain":
		var p struct {
			Domain      string `json:"domain"`
			NginxConfig string `json:"nginx_config"`
			SSLMode     string `json:"ssl_mode"`
		}
		json.Unmarshal(payload, &p)
		return legacy(e.applyDomain(p.Domain, p.NginxConfig, p.SSLMode))

	case "remove_domain":
		var p struct {
			Domain string `json:"domain"`
		}
		json.Unmarshal(payload, &p)
		return legacy(e.removeDomain(p.Domain))

	default:
		return fmt.Errorf("unknown job type: %s", jobType)
	}
}

// serviceOp manages systemd services
func serviceOp(ctx context.Context, name, action string) (string, error) {
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

	_, err := runProcess(ctx, []string{"systemctl", action, name}, nil, 120, &logs, false)
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
	if err := ensureNginxBansSnippet(); err != nil {
		logs.WriteString(fmt.Sprintf("Warning: failed to initialize nginx bans snippet: %v\n", err))
	}
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

	if err := ensureNginxBansSnippet(); err != nil {
		return logs.String(), fmt.Errorf("failed to initialize nginx bans snippet: %v", err)
	}

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

func ensureNginxBansSnippet() error {
	const snippetDir = "/etc/nginx/snippets"
	const snippetPath = snippetDir + "/configuratix-bans.conf"

	if err := os.MkdirAll(snippetDir, 0755); err != nil {
		return err
	}

	if _, err := os.Stat(snippetPath); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}

	content := "# Configuratix Security - Banned IPs\n# Auto-generated - do not edit manually\n"
	return os.WriteFile(snippetPath, []byte(content), 0644)
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

func runCommand(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	output := stdout.String() + stderr.String()
	return output, err
}
