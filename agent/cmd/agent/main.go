package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"strings"
	"time"

	"configuratix/agent/internal/client"
	"configuratix/agent/internal/config"
	"configuratix/agent/internal/executor"
	"configuratix/agent/internal/files"
	"configuratix/agent/internal/terminal"
	"configuratix/agent/internal/updater"
)

const Version = "0.4.1"

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
	case "version":
		fmt.Printf("Configuratix Agent %s\n", Version)
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

	log.Printf("Starting Configuratix Agent %s", Version)
	log.Printf("Server: %s", cfg.ServerURL)
	log.Printf("Agent ID: %s", cfg.AgentID)

	c := client.New(cfg.ServerURL, cfg.APIKey)
	exec := executor.New()
	exec.SetConfig(cfg.ServerURL, cfg.APIKey)

	// Start terminal connection in background
	go terminal.RunTerminalLoop(cfg.ServerURL, cfg.APIKey)

	// Start file handler connection in background
	go files.RunFileLoop(cfg.ServerURL, cfg.APIKey)

	// Start auto-updater in background
	go updater.New(cfg.ServerURL, Version).Run()

	// Heartbeat ticker
	heartbeatTicker := time.NewTicker(30 * time.Second)
	defer heartbeatTicker.Stop()

	// Job poll ticker
	jobTicker := time.NewTicker(5 * time.Second)
	defer jobTicker.Stop()

	// Initial heartbeat
	c.Heartbeat(Version)

	for {
		select {
		case <-heartbeatTicker.C:
			if err := c.Heartbeat(Version); err != nil {
				log.Printf("Heartbeat failed: %v", err)
			}

		case <-jobTicker.C:
			jobs, err := c.GetJobs()
			if err != nil {
				log.Printf("Failed to get jobs: %v", err)
				continue
			}

			for _, job := range jobs {
				log.Printf("Processing job %s (type: %s)", job.ID, job.Type)

				// Mark as running
				c.UpdateJob(job.ID, "running", "Starting job execution...")

				// Execute job
				logs, err := exec.Execute(job.Type, job.Payload)
				if err != nil {
					log.Printf("Job %s failed: %v", job.ID, err)
					c.UpdateJob(job.ID, "failed", logs+"\nError: "+err.Error())
				} else {
					log.Printf("Job %s completed", job.ID)
					c.UpdateJob(job.ID, "completed", logs)
				}
			}
		}
	}
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

