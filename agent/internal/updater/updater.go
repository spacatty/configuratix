// Package updater implements server-driven agent self-update.
//
// The periodic checker only *reports* whether an update is available (in the
// heartbeat); it never installs anything. Installation happens exclusively via
// an `update_agent` job (see Apply).
package updater

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"runtime"
	"sync"
	"time"
)

// ArchInfo is the per-architecture binary info published by the backend.
type ArchInfo struct {
	Checksum string `json:"checksum"`
	Size     int64  `json:"size"`
}

// VersionInfo contains version information from the server
type VersionInfo struct {
	Version   string              `json:"version"`
	Checksum  string              `json:"checksum"` // legacy: amd64 checksum
	Size      int64               `json:"size"`
	UpdatedAt string              `json:"updated_at"`
	Arches    map[string]ArchInfo `json:"arches,omitempty"`
}

// ChecksumFor returns the published sha256 for arch ("" if unknown).
func (v *VersionInfo) ChecksumFor(arch string) string {
	if v == nil {
		return ""
	}
	if a, ok := v.Arches[arch]; ok && a.Checksum != "" {
		return a.Checksum
	}
	if arch == "amd64" && len(v.Arches) == 0 {
		return v.Checksum
	}
	return ""
}

// Updater checks versions and applies server-driven updates.
type Updater struct {
	serverURL       string
	apiKey          string
	currentVersion  string
	httpClient      *http.Client
	latestVersion   *VersionInfo
	updateAvailable bool
	mu              sync.RWMutex
}

var instance *Updater
var once sync.Once

// New creates (or returns) the process-wide Updater.
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

// SetAPIKey sets the agent API key sent with downloads.
func (u *Updater) SetAPIKey(k string) {
	u.mu.Lock()
	u.apiKey = k
	u.mu.Unlock()
}

// Run starts the version checker loop (checks only, never installs).
func (u *Updater) Run() {
	time.Sleep(30 * time.Second)
	u.checkForUpdates()

	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		u.checkForUpdates()
	}
}

func (u *Updater) checkForUpdates() {
	info, err := u.getServerVersion()
	if err != nil {
		return
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	u.latestVersion = info
	avail := info.Version != "" && info.Version != u.currentVersion
	if avail && !u.updateAvailable {
		log.Printf("Update available: %s (current: %s) - waiting for server-triggered update",
			info.Version, u.currentVersion)
	}
	u.updateAvailable = avail
}

// IsUpdateAvailable returns true if the server publishes a different version.
func (u *Updater) IsUpdateAvailable() bool {
	if u == nil {
		return false
	}
	u.mu.RLock()
	defer u.mu.RUnlock()
	return u.updateAvailable
}

// GetLatestVersion returns the latest version info
func (u *Updater) GetLatestVersion() *VersionInfo {
	if u == nil {
		return nil
	}
	u.mu.RLock()
	defer u.mu.RUnlock()
	return u.latestVersion
}

// GetCurrentVersion returns the current version
func (u *Updater) GetCurrentVersion() string {
	return u.currentVersion
}

func (u *Updater) getServerVersion() (*VersionInfo, error) {
	resp, err := u.httpClient.Get(u.serverURL + "/api/agent/version?arch=" + runtime.GOARCH)
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
