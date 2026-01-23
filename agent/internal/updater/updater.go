package updater

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

// VersionInfo contains version information from the server
type VersionInfo struct {
	Version   string `json:"version"`
	Checksum  string `json:"checksum"`
	Size      int64  `json:"size"`
	UpdatedAt string `json:"updated_at"`
}

// Updater handles automatic agent updates
type Updater struct {
	serverURL      string
	currentVersion string
	checkInterval  time.Duration
	httpClient     *http.Client
}

// New creates a new Updater
func New(serverURL, currentVersion string) *Updater {
	return &Updater{
		serverURL:      serverURL,
		currentVersion: currentVersion,
		checkInterval:  5 * time.Minute, // Check every 5 minutes
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Run starts the update checker loop
func (u *Updater) Run() {
	// Initial check after 30 seconds
	time.Sleep(30 * time.Second)
	u.checkAndUpdate()
	
	// Then check periodically
	ticker := time.NewTicker(u.checkInterval)
	defer ticker.Stop()
	
	for range ticker.C {
		u.checkAndUpdate()
	}
}

// checkAndUpdate checks for updates and applies if available
func (u *Updater) checkAndUpdate() {
	info, err := u.getServerVersion()
	if err != nil {
		log.Printf("Failed to check for updates: %v", err)
		return
	}
	
	if info.Version == u.currentVersion {
		return // Already up to date
	}
	
	log.Printf("New agent version available: %s (current: %s)", info.Version, u.currentVersion)
	
	if err := u.downloadAndUpdate(info); err != nil {
		log.Printf("Failed to update agent: %v", err)
		return
	}
	
	log.Printf("Agent updated to version %s, restarting...", info.Version)
	u.restart()
}

// getServerVersion fetches the current version from the server
func (u *Updater) getServerVersion() (*VersionInfo, error) {
	resp, err := u.httpClient.Get(u.serverURL + "/api/agent/version")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server returned status %d", resp.StatusCode)
	}
	
	var info VersionInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, err
	}
	
	return &info, nil
}

// downloadAndUpdate downloads the new binary and replaces the current one
func (u *Updater) downloadAndUpdate(info *VersionInfo) error {
	// Get current executable path
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get executable path: %v", err)
	}
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		return fmt.Errorf("failed to resolve executable path: %v", err)
	}
	
	// Download new binary to temp file
	tempPath := execPath + ".new"
	if err := u.downloadBinary(tempPath, info.Checksum); err != nil {
		os.Remove(tempPath)
		return fmt.Errorf("failed to download binary: %v", err)
	}
	
	// Make it executable
	if err := os.Chmod(tempPath, 0755); err != nil {
		os.Remove(tempPath)
		return fmt.Errorf("failed to chmod: %v", err)
	}
	
	// Backup current binary
	backupPath := execPath + ".old"
	os.Remove(backupPath) // Remove old backup if exists
	if err := os.Rename(execPath, backupPath); err != nil {
		os.Remove(tempPath)
		return fmt.Errorf("failed to backup current binary: %v", err)
	}
	
	// Move new binary to current location
	if err := os.Rename(tempPath, execPath); err != nil {
		// Try to restore backup
		os.Rename(backupPath, execPath)
		return fmt.Errorf("failed to install new binary: %v", err)
	}
	
	// Remove backup (optional, can keep for rollback)
	os.Remove(backupPath)
	
	return nil
}

// downloadBinary downloads the agent binary and verifies checksum
func (u *Updater) downloadBinary(destPath, expectedChecksum string) error {
	resp, err := u.httpClient.Get(u.serverURL + "/api/agent/download")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned status %d", resp.StatusCode)
	}
	
	// Create temp file
	file, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer file.Close()
	
	// Download and calculate checksum
	hasher := sha256.New()
	writer := io.MultiWriter(file, hasher)
	
	if _, err := io.Copy(writer, resp.Body); err != nil {
		return err
	}
	
	// Verify checksum
	actualChecksum := hex.EncodeToString(hasher.Sum(nil))
	if actualChecksum != expectedChecksum {
		return fmt.Errorf("checksum mismatch: expected %s, got %s", expectedChecksum, actualChecksum)
	}
	
	return nil
}

// restart restarts the agent process
func (u *Updater) restart() {
	execPath, err := os.Executable()
	if err != nil {
		log.Printf("Failed to get executable path for restart: %v", err)
		os.Exit(1)
	}
	
	args := os.Args
	env := os.Environ()
	
	if runtime.GOOS == "windows" {
		// On Windows, we can't replace the running executable directly
		// Start new process and exit current
		cmd := exec.Command(execPath, args[1:]...)
		cmd.Env = env
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Start()
		os.Exit(0)
	} else {
		// On Unix, use syscall.Exec to replace current process
		// This is cleaner as PID stays the same
		execErr := execSyscall(execPath, args, env)
		if execErr != nil {
			log.Printf("Failed to exec: %v", execErr)
			os.Exit(1)
		}
	}
}

