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
	"sync"
	"time"
)

// VersionInfo contains version information from the server
type VersionInfo struct {
	Version   string `json:"version"`
	Checksum  string `json:"checksum"`
	Size      int64  `json:"size"`
	UpdatedAt string `json:"updated_at"`
}

// Updater handles agent updates (manual only - no auto-updates)
type Updater struct {
	serverURL       string
	currentVersion  string
	httpClient      *http.Client
	latestVersion   *VersionInfo
	updateAvailable bool
	mu              sync.RWMutex
}

var instance *Updater
var once sync.Once

// New creates a new Updater
func New(serverURL, currentVersion string) *Updater {
	once.Do(func() {
		instance = &Updater{
			serverURL:      serverURL,
			currentVersion: currentVersion,
			httpClient: &http.Client{
				Timeout: 30 * time.Second,
			},
		}
	})
	return instance
}

// GetInstance returns the singleton updater instance
func GetInstance() *Updater {
	return instance
}

// Run starts the version checker loop (checks only, NO auto-updates)
func (u *Updater) Run() {
	// Initial check after 30 seconds
	time.Sleep(30 * time.Second)
	u.checkForUpdates()

	// Then check periodically (every 5 minutes)
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		u.checkForUpdates()
	}
}

// checkForUpdates checks for updates but does NOT apply them
func (u *Updater) checkForUpdates() {
	info, err := u.getServerVersion()
	if err != nil {
		// Silently fail - server might not have update endpoint
		return
	}

	u.mu.Lock()
	defer u.mu.Unlock()

	u.latestVersion = info
	u.updateAvailable = info.Version != u.currentVersion

	if u.updateAvailable {
		log.Printf("Update available: %s (current: %s) - waiting for manual trigger",
			info.Version, u.currentVersion)
	}
}

// IsUpdateAvailable returns true if an update is available
func (u *Updater) IsUpdateAvailable() bool {
	u.mu.RLock()
	defer u.mu.RUnlock()
	return u.updateAvailable
}

// GetLatestVersion returns the latest version info
func (u *Updater) GetLatestVersion() *VersionInfo {
	u.mu.RLock()
	defer u.mu.RUnlock()
	return u.latestVersion
}

// GetCurrentVersion returns the current version
func (u *Updater) GetCurrentVersion() string {
	return u.currentVersion
}

// TriggerUpdate manually triggers an update (called from job handler)
func (u *Updater) TriggerUpdate() error {
	info, err := u.getServerVersion()
	if err != nil {
		return fmt.Errorf("failed to get server version: %v", err)
	}

	if info.Version == u.currentVersion {
		return fmt.Errorf("already on latest version %s", u.currentVersion)
	}

	log.Printf("Manual update triggered: %s -> %s", u.currentVersion, info.Version)

	if err := u.downloadAndUpdate(info); err != nil {
		return fmt.Errorf("failed to update: %v", err)
	}

	log.Printf("Agent updated to version %s, restarting...", info.Version)
	u.restart()
	return nil
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
