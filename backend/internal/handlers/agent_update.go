package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"configuratix/backend/internal/database"
)

// AgentUpdateHandler handles agent update distribution
type AgentUpdateHandler struct {
	db          *database.DB
	binaryDir   string
	versionInfo *AgentVersionInfo
	versionLock sync.RWMutex
}

// AgentVersionInfo contains version information for the agent
type AgentVersionInfo struct {
	Version   string `json:"version"`
	Checksum  string `json:"checksum"` // SHA256 of the binary
	Size      int64  `json:"size"`
	UpdatedAt string `json:"updated_at"`
}

// NewAgentUpdateHandler creates a new agent update handler
func NewAgentUpdateHandler(db *database.DB, binaryDir string) *AgentUpdateHandler {
	h := &AgentUpdateHandler{
		db:        db,
		binaryDir: binaryDir,
	}
	
	// Load initial version info
	h.loadVersionInfo()
	
	return h
}

// loadVersionInfo reads version info from the binary directory
func (h *AgentUpdateHandler) loadVersionInfo() {
	versionFile := filepath.Join(h.binaryDir, "version.json")
	data, err := os.ReadFile(versionFile)
	if err != nil {
		log.Printf("No agent version file found at %s", versionFile)
		return
	}
	
	var info AgentVersionInfo
	if err := json.Unmarshal(data, &info); err != nil {
		log.Printf("Failed to parse agent version file: %v", err)
		return
	}
	
	h.versionLock.Lock()
	h.versionInfo = &info
	h.versionLock.Unlock()
	
	log.Printf("Agent version loaded: %s (checksum: %s)", info.Version, info.Checksum[:16]+"...")
}

// GetVersion returns the current agent version info
func (h *AgentUpdateHandler) GetVersion(w http.ResponseWriter, r *http.Request) {
	h.versionLock.RLock()
	info := h.versionInfo
	h.versionLock.RUnlock()
	
	if info == nil {
		http.Error(w, "No agent version available", http.StatusNotFound)
		return
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(info)
}

// DownloadAgent serves the agent binary for download
func (h *AgentUpdateHandler) DownloadAgent(w http.ResponseWriter, r *http.Request) {
	h.versionLock.RLock()
	info := h.versionInfo
	h.versionLock.RUnlock()
	
	if info == nil {
		http.Error(w, "No agent binary available", http.StatusNotFound)
		return
	}
	
	binaryPath := filepath.Join(h.binaryDir, "configuratix-agent")
	file, err := os.Open(binaryPath)
	if err != nil {
		log.Printf("Failed to open agent binary: %v", err)
		http.Error(w, "Agent binary not found", http.StatusNotFound)
		return
	}
	defer file.Close()
	
	stat, err := file.Stat()
	if err != nil {
		http.Error(w, "Failed to stat binary", http.StatusInternalServerError)
		return
	}
	
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment; filename=configuratix-agent")
	w.Header().Set("X-Agent-Version", info.Version)
	w.Header().Set("X-Agent-Checksum", info.Checksum)
	w.Header().Set("Content-Length", string(rune(stat.Size())))
	
	io.Copy(w, file)
}

// UploadAgent allows uploading a new agent binary (admin only)
func (h *AgentUpdateHandler) UploadAgent(w http.ResponseWriter, r *http.Request) {
	// Parse version from form
	version := r.FormValue("version")
	if version == "" {
		http.Error(w, "Version is required", http.StatusBadRequest)
		return
	}
	
	// Get the uploaded file
	file, _, err := r.FormFile("binary")
	if err != nil {
		http.Error(w, "Binary file is required", http.StatusBadRequest)
		return
	}
	defer file.Close()
	
	// Create binary directory if it doesn't exist
	if err := os.MkdirAll(h.binaryDir, 0755); err != nil {
		http.Error(w, "Failed to create binary directory", http.StatusInternalServerError)
		return
	}
	
	// Write to temp file first
	tempPath := filepath.Join(h.binaryDir, "configuratix-agent.tmp")
	tempFile, err := os.Create(tempPath)
	if err != nil {
		http.Error(w, "Failed to create temp file", http.StatusInternalServerError)
		return
	}
	
	// Calculate checksum while writing
	hasher := sha256.New()
	writer := io.MultiWriter(tempFile, hasher)
	
	size, err := io.Copy(writer, file)
	tempFile.Close()
	if err != nil {
		os.Remove(tempPath)
		http.Error(w, "Failed to write binary", http.StatusInternalServerError)
		return
	}
	
	checksum := hex.EncodeToString(hasher.Sum(nil))
	
	// Move temp file to final location
	finalPath := filepath.Join(h.binaryDir, "configuratix-agent")
	if err := os.Rename(tempPath, finalPath); err != nil {
		os.Remove(tempPath)
		http.Error(w, "Failed to finalize binary", http.StatusInternalServerError)
		return
	}
	
	// Make it executable
	os.Chmod(finalPath, 0755)
	
	// Update version info
	info := &AgentVersionInfo{
		Version:   version,
		Checksum:  checksum,
		Size:      size,
		UpdatedAt: r.Header.Get("Date"),
	}
	
	// Save version file
	versionData, _ := json.MarshalIndent(info, "", "  ")
	versionPath := filepath.Join(h.binaryDir, "version.json")
	if err := os.WriteFile(versionPath, versionData, 0644); err != nil {
		log.Printf("Failed to write version file: %v", err)
	}
	
	h.versionLock.Lock()
	h.versionInfo = info
	h.versionLock.Unlock()
	
	log.Printf("Agent binary uploaded: version=%s, size=%d, checksum=%s", version, size, checksum[:16]+"...")
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(info)
}

// ReloadVersion reloads version info from disk
func (h *AgentUpdateHandler) ReloadVersion(w http.ResponseWriter, r *http.Request) {
	h.loadVersionInfo()
	
	h.versionLock.RLock()
	info := h.versionInfo
	h.versionLock.RUnlock()
	
	if info == nil {
		http.Error(w, "No version info loaded", http.StatusNotFound)
		return
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(info)
}

