package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"configuratix/agent/internal/client"
	"configuratix/agent/internal/config"
	"configuratix/agent/internal/executor"
	"configuratix/agent/internal/files"
	"configuratix/agent/internal/security"
	"configuratix/agent/internal/state"
	"configuratix/agent/internal/stats"
	"configuratix/agent/internal/terminal"
	"configuratix/agent/internal/updater"
	"configuratix/agent/internal/worker"
)

// fallbackVersion is used when the binary was built without
// -ldflags "-X main.Version=...". Keep in sync with backend/agent-binaries/version.json.
const fallbackVersion = "0.6.0"

// Version is injected at build time by the backend (-X main.Version=<target>).
var Version = ""

func init() {
	if Version == "" {
		Version = fallbackVersion
	}
}

func main() {
	enrollCmd := flag.NewFlagSet("enroll", flag.ExitOnError)
	enrollServer := enrollCmd.String("server", "", "Backend server URL")
	enrollToken := enrollCmd.String("token", "", "Enrollment token")

	runCmd := flag.NewFlagSet("run", flag.ExitOnError)

	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	switch os.Args[1] {
	case "enroll":
		enrollCmd.Parse(os.Args[2:])
		if *enrollServer == "" || *enrollToken == "" {
			log.Fatal("Both --server and --token are required")
		}
		if err := enroll(*enrollServer, *enrollToken); err != nil {
			log.Fatal(err)
		}
	case "run":
		runCmd.Parse(os.Args[2:])
		if err := run(); err != nil {
			log.Fatal(err)
		}
	case "version", "--version":
		fmt.Printf("Configuratix Agent %s\n", Version)
	case "--self-test", "self-test":
		os.Exit(selfTest())
	default:
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println("Configuratix Agent")
	fmt.Println()
	fmt.Println("Usage:")
	fmt.Println("  configuratix-agent enroll --server URL --token TOKEN")
	fmt.Println("  configuratix-agent run")
	fmt.Println("  configuratix-agent version")
	fmt.Println("  configuratix-agent --self-test")
}

func enroll(serverURL, token string) error {
	log.Printf("Enrolling with server %s...", serverURL)

	hostname, _ := os.Hostname()
	ip := getOutboundIP()
	osVersion := getOSVersion()

	c := client.New(serverURL, "")
	resp, err := c.Enroll(client.EnrollRequest{
		Token:    token,
		Hostname: hostname,
		IP:       ip,
		OS:       osVersion,
	})
	if err != nil {
		return fmt.Errorf("enrollment failed: %v", err)
	}

	cfg := &config.Config{
		ServerURL: serverURL,
		AgentID:   resp.AgentID,
		APIKey:    resp.APIKey,
	}

	if err := cfg.Save(); err != nil {
		return fmt.Errorf("failed to save config: %v", err)
	}

	log.Printf("Enrolled successfully! Agent ID: %s", resp.AgentID)
	log.Println("Run 'configuratix-agent run' to start the agent")
	return nil
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("failed to load config (run 'enroll' first): %v", err)
	}

	log.Printf("Starting Configuratix Agent %s (%s/%s)", Version, runtime.GOOS, runtime.GOARCH)
	log.Printf("Server: %s", cfg.ServerURL)
	log.Printf("Agent ID: %s", cfg.AgentID)

	// Report the outcome of a previous self-update (if any) in heartbeats.
	updater.CheckOnStartup(Version)

	c := client.New(cfg.ServerURL, cfg.APIKey)
	exec := executor.New()
	exec.SetConfig(cfg.ServerURL, cfg.APIKey)
	exec.SetVersion(Version)

	// Start terminal connection in background
	go terminal.RunTerminalLoop(cfg.ServerURL, cfg.APIKey)

	// Start file handler connection in background
	go files.RunFileLoop(cfg.ServerURL, cfg.APIKey)

	// Version checker: reports update availability only, never installs.
	upd := updater.New(cfg.ServerURL, Version)
	upd.SetAPIKey(cfg.APIKey)
	go upd.Run()

	// Start security module (Linux only)
	var securityModule *security.Module
	log.Printf("OS: %s, starting security module check...", runtime.GOOS)
	if runtime.GOOS == "linux" {
		log.Println("Initializing security module...")
		securityModule = security.New(security.Config{
			Enabled:          true,
			ServerURL:        cfg.ServerURL,
			APIKey:           cfg.APIKey,
			MachineID:        cfg.AgentID,     // Using AgentID as machine identifier
			SyncInterval:     1 * time.Minute, // Sync every minute
			SecurityLogPath:  "/var/log/nginx/security-blocked.log",
			NginxIncludePath: "/etc/nginx/snippets/configuratix-bans.conf",
		})
		if err := securityModule.Start(); err != nil {
			log.Printf("Security module failed to start: %v", err)
			// Continue anyway - non-fatal
		} else {
			log.Println("Security module initialized successfully")
		}
	} else {
		log.Printf("Security module skipped (OS: %s, requires linux)", runtime.GOOS)
	}

	// Jobs run in their own goroutine, sequentially, so long jobs never
	// delay heartbeats.
	go worker.New(c, exec).Run()

	heartbeatLoop(c, upd)
	return nil
}

// heartbeatPayload is stats.Stats plus runtime/job/update state.
type heartbeatPayload struct {
	stats.Stats
	Arch                string   `json:"arch"`
	OS                  string   `json:"os"`
	Capabilities        []string `json:"capabilities"`
	RunningJobID        *string  `json:"running_job_id"`
	UpdateState         string   `json:"update_state,omitempty"`
	UpdateTargetVersion string   `json:"update_target_version,omitempty"`
	UpdateError         string   `json:"update_error,omitempty"`
	UpdateJobID         string   `json:"update_job_id,omitempty"`
	UpdateAvailable     bool     `json:"update_available"`
	LatestVersion       string   `json:"latest_version,omitempty"`
}

func buildHeartbeat(upd *updater.Updater) (heartbeatPayload, state.Snapshot) {
	st := state.Get()
	hb := heartbeatPayload{
		Stats:               stats.Collect(Version),
		Arch:                runtime.GOARCH,
		OS:                  runtime.GOOS,
		Capabilities:        executor.Capabilities,
		UpdateState:         st.UpdateState,
		UpdateTargetVersion: st.UpdateTargetVersion,
		UpdateError:         st.UpdateError,
		UpdateJobID:         st.UpdateJobID,
		UpdateAvailable:     upd.IsUpdateAvailable(),
	}
	if st.RunningJobID != "" {
		id := st.RunningJobID
		hb.RunningJobID = &id
	}
	if lv := upd.GetLatestVersion(); lv != nil {
		hb.LatestVersion = lv.Version
	}
	return hb, st
}

func heartbeatLoop(c *client.Client, upd *updater.Updater) {
	const interval = 30 * time.Second
	const retryInterval = 5 * time.Second

	send := func() bool {
		hb, st := buildHeartbeat(upd)
		if _, err := c.Heartbeat(hb); err != nil {
			log.Printf("Heartbeat failed: %v", err)
			return false
		}
		updater.AfterHeartbeat()
		state.ClearUpdateIfTerminal(st.UpdateChangedAt)
		return true
	}

	timer := time.NewTimer(0)
	defer timer.Stop()
	lastSent := time.Time{}
	for {
		select {
		case <-timer.C:
		case <-state.KickChan():
			// Coalesce bursts of state changes.
			if time.Since(lastSent) < 2*time.Second {
				time.Sleep(2 * time.Second)
			}
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
		}
		ok := send()
		lastSent = time.Now()
		if ok {
			timer.Reset(interval)
		} else {
			timer.Reset(retryInterval)
		}
	}
}

// selfTest is run by the updater on a freshly downloaded binary before it is
// installed: the config must load and the version is printed for comparison.
func selfTest() int {
	if _, err := config.Load(); err != nil {
		fmt.Printf("configuratix-agent self-test FAILED: config: %v\n", err)
		return 1
	}
	fmt.Printf("configuratix-agent self-test ok arch=%s version=%s\n", runtime.GOARCH, Version)
	return 0
}

func getOutboundIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return ""
	}
	defer conn.Close()
	localAddr := conn.LocalAddr().(*net.UDPAddr)
	return localAddr.IP.String()
}

func getOSVersion() string {
	out, err := exec.Command("lsb_release", "-d", "-s").Output()
	if err != nil {
		return "Unknown"
	}
	return strings.TrimSpace(string(out))
}
