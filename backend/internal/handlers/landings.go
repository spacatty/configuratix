package handlers

import (
	"archive/zip"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/database"
	"configuratix/backend/internal/models"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

const (
	MaxUploadSize   = 50 << 20 // 50MB
	LandingsBaseDir = "data/landings"
	PreviewBaseDir  = "data/previews"
)

type LandingsHandler struct {
	db *database.DB
}

func NewLandingsHandler(db *database.DB) *LandingsHandler {
	// Ensure directories exist
	os.MkdirAll(LandingsBaseDir, 0755)
	os.MkdirAll(PreviewBaseDir, 0755)
	return &LandingsHandler{db: db}
}

// ListLandings returns all landings for the current user
func (h *LandingsHandler) ListLandings(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var landings []models.LandingWithOwner

	if claims.IsSuperAdmin() {
		err := h.db.Select(&landings, `
			SELECT l.*, u.email as owner_email, COALESCE(u.name, u.email) as owner_name
			FROM landings l
			LEFT JOIN users u ON l.owner_id = u.id
			ORDER BY l.created_at DESC
		`)
		if err != nil {
			log.Printf("Failed to list landings: %v", err)
			http.Error(w, "Failed to list landings", http.StatusInternalServerError)
			return
		}
	} else {
		err := h.db.Select(&landings, `
			SELECT l.*, u.email as owner_email, COALESCE(u.name, u.email) as owner_name
			FROM landings l
			LEFT JOIN users u ON l.owner_id = u.id
			WHERE l.owner_id = $1
			ORDER BY l.created_at DESC
		`, userID)
		if err != nil {
			log.Printf("Failed to list landings: %v", err)
			http.Error(w, "Failed to list landings", http.StatusInternalServerError)
			return
		}
	}

	if landings == nil {
		landings = []models.LandingWithOwner{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(landings)
}

// UploadLanding handles landing page upload
func (h *LandingsHandler) UploadLanding(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	// Limit upload size
	r.Body = http.MaxBytesReader(w, r.Body, MaxUploadSize)

	// Parse multipart form
	if err := r.ParseMultipartForm(MaxUploadSize); err != nil {
		http.Error(w, "File too large (max 50MB)", http.StatusBadRequest)
		return
	}

	// Get form values
	name := r.FormValue("name")
	if name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}

	// Get uploaded file
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "File is required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Validate file extension
	if !strings.HasSuffix(strings.ToLower(header.Filename), ".zip") {
		http.Error(w, "Only .zip files are allowed", http.StatusBadRequest)
		return
	}

	// Generate unique storage path
	landingID := uuid.New()
	storagePath := filepath.Join(LandingsBaseDir, landingID.String()+".zip")

	// Save file
	dst, err := os.Create(storagePath)
	if err != nil {
		log.Printf("Failed to create file: %v", err)
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	written, err := io.Copy(dst, file)
	if err != nil {
		os.Remove(storagePath)
		log.Printf("Failed to write file: %v", err)
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}

	// Auto-detect landing type by scanning zip contents for PHP files
	landingType := detectLandingType(storagePath)
	log.Printf("Auto-detected landing type: %s for %s", landingType, name)

	// Create preview (extract to preview dir with random token)
	previewToken := generateRandomToken(16)
	previewPath := filepath.Join(PreviewBaseDir, previewToken)
	if err := h.extractZipForPreview(storagePath, previewPath, landingType); err != nil {
		log.Printf("Failed to create preview: %v", err)
		// Non-fatal, continue without preview
		previewPath = ""
	}

	// Store preview path as relative URL
	var previewURL *string
	if previewPath != "" {
		url := "/api/static/preview/" + previewToken + "/"
		previewURL = &url
	}

	// Insert into database
	var landing models.Landing
	err = h.db.Get(&landing, `
		INSERT INTO landings (id, name, owner_id, type, file_name, file_size, storage_path, preview_path)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING *
	`, landingID, name, userID, landingType, header.Filename, written, storagePath, previewURL)
	if err != nil {
		os.Remove(storagePath)
		os.RemoveAll(previewPath)
		log.Printf("Failed to insert landing: %v", err)
		http.Error(w, "Failed to save landing", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(landing)
}

// detectLandingType scans a zip file and returns:
// - "php" if any PHP files are found
// - "html" if any HTML files are found (but no PHP)
// - "asset" if neither PHP nor HTML files are found (static assets for download)
func detectLandingType(zipPath string) string {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		log.Printf("Failed to open zip for type detection: %v", err)
		return "html" // Default to HTML on error
	}
	defer r.Close()

	hasPHP := false
	hasHTML := false

	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(f.Name))
		
		// Check for PHP files
		if ext == ".php" || ext == ".phtml" || ext == ".php3" || ext == ".php4" || ext == ".php5" {
			hasPHP = true
			break // PHP takes priority, no need to continue
		}
		
		// Check for HTML files
		if ext == ".html" || ext == ".htm" {
			hasHTML = true
		}
	}

	if hasPHP {
		return "php"
	}
	if hasHTML {
		return "html"
	}
	return "asset" // Static files for download (no index page)
}

// extractZipForPreview extracts zip file to preview directory with security measures
func (h *LandingsHandler) extractZipForPreview(zipPath, destPath string, landingType string) error {
	// Open zip file
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	// Create destination directory
	if err := os.MkdirAll(destPath, 0755); err != nil {
		return err
	}

	// Dangerous file extensions to block (security)
	dangerousExts := map[string]bool{
		".php":    landingType != "php", // Only allow PHP if type is PHP
		".phtml":  true,
		".php3":   true,
		".php4":   true,
		".php5":   true,
		".phps":   true,
		".phar":   true,
		".sh":     true,
		".bash":   true,
		".py":     true,
		".pl":     true,
		".cgi":    true,
		".asp":    true,
		".aspx":   true,
		".jsp":    true,
		".exe":    true,
		".dll":    true,
		".so":     true,
		".htaccess": true,
	}

	for _, f := range r.File {
		// Security: Prevent zip slip
		fpath := filepath.Join(destPath, f.Name)
		if !strings.HasPrefix(fpath, filepath.Clean(destPath)+string(os.PathSeparator)) {
			return fmt.Errorf("illegal file path: %s", f.Name)
		}

		// Check for dangerous extensions
		ext := strings.ToLower(filepath.Ext(f.Name))
		baseName := strings.ToLower(filepath.Base(f.Name))
		if dangerousExts[ext] || dangerousExts[baseName] {
			continue // Skip dangerous files
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(fpath, 0755)
			continue
		}

		// Create parent directory
		if err := os.MkdirAll(filepath.Dir(fpath), 0755); err != nil {
			return err
		}

		// Create file
		outFile, err := os.OpenFile(fpath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
		if err != nil {
			return err
		}

		rc, err := f.Open()
		if err != nil {
			outFile.Close()
			return err
		}

		// Limit file size to prevent zip bombs
		_, err = io.CopyN(outFile, rc, 10<<20) // 10MB max per file
		if err != nil && err != io.EOF {
			outFile.Close()
			rc.Close()
			return err
		}

		outFile.Close()
		rc.Close()
	}

	return nil
}

// ServePreview serves static content preview (static files only, no PHP execution)
func (h *LandingsHandler) ServePreview(w http.ResponseWriter, r *http.Request) {
	// Parse URL: /api/static/preview/{token}/{path...}
	urlPath := strings.TrimPrefix(r.URL.Path, "/api/static/preview/")
	parts := strings.SplitN(urlPath, "/", 2)
	if len(parts) == 0 || parts[0] == "" {
		log.Printf("Preview: missing token in URL: %s", r.URL.Path)
		http.Error(w, "Missing preview token", http.StatusBadRequest)
		return
	}
	
	token := parts[0]
	filePath := ""
	if len(parts) > 1 {
		filePath = parts[1]
	}

	// Validate token format (32 hex chars)
	if len(token) != 32 || !isAlphanumeric(token) {
		log.Printf("Preview: invalid token format: %s (len=%d)", token, len(token))
		http.Error(w, "Invalid preview token", http.StatusBadRequest)
		return
	}

	// Build full path - use absolute path from working directory
	previewDir, _ := filepath.Abs(filepath.Join(PreviewBaseDir, token))
	if filePath == "" {
		filePath = "index.html"
	}
	fullPath := filepath.Join(previewDir, filePath)

	log.Printf("Preview: token=%s, file=%s, fullPath=%s", token, filePath, fullPath)

	// Security: Prevent path traversal
	cleanPreviewDir := filepath.Clean(previewDir)
	if !strings.HasPrefix(fullPath, cleanPreviewDir) {
		log.Printf("Preview: path traversal attempt: %s not in %s", fullPath, cleanPreviewDir)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	// Check if directory exists first
	if _, err := os.Stat(previewDir); os.IsNotExist(err) {
		log.Printf("Preview: directory does not exist: %s", previewDir)
		http.Error(w, "Preview not found - landing may have been deleted", http.StatusNotFound)
		return
	}

	// Check if file exists
	info, err := os.Stat(fullPath)
	if err != nil {
		// Try index.html in directory
		if os.IsNotExist(err) {
			indexPath := filepath.Join(fullPath, "index.html")
			if _, err := os.Stat(indexPath); err == nil {
				fullPath = indexPath
				info, _ = os.Stat(fullPath)
			} else {
				log.Printf("Preview: file not found: %s", fullPath)
				http.Error(w, "File not found", http.StatusNotFound)
				return
			}
		} else {
			log.Printf("Preview: stat error: %v", err)
			http.Error(w, "File not found", http.StatusNotFound)
			return
		}
	}
	
	if info != nil && info.IsDir() {
		fullPath = filepath.Join(fullPath, "index.html")
		if _, err := os.Stat(fullPath); err != nil {
			http.Error(w, "File not found", http.StatusNotFound)
			return
		}
	}

	// Block PHP execution in preview (serve as plain text)
	ext := strings.ToLower(filepath.Ext(fullPath))
	if ext == ".php" {
		w.Header().Set("Content-Type", "text/plain")
		http.ServeFile(w, r, fullPath)
		return
	}

	// Serve file
	http.ServeFile(w, r, fullPath)
}

// GetLanding returns a single landing
func (h *LandingsHandler) GetLanding(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	landingID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid landing ID", http.StatusBadRequest)
		return
	}

	var landing models.Landing
	err = h.db.Get(&landing, "SELECT * FROM landings WHERE id = $1", landingID)
	if err != nil {
		http.Error(w, "Landing not found", http.StatusNotFound)
		return
	}

	// Check access
	if landing.OwnerID != userID && !claims.IsSuperAdmin() {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(landing)
}

// UpdateLanding updates landing name/type
func (h *LandingsHandler) UpdateLanding(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	landingID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid landing ID", http.StatusBadRequest)
		return
	}

	// Check ownership
	var ownerID uuid.UUID
	err = h.db.Get(&ownerID, "SELECT owner_id FROM landings WHERE id = $1", landingID)
	if err != nil {
		http.Error(w, "Landing not found", http.StatusNotFound)
		return
	}
	if ownerID != userID && !claims.IsSuperAdmin() {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	var req struct {
		Name *string `json:"name"`
		Type *string `json:"type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	_, err = h.db.Exec(`
		UPDATE landings SET 
			name = COALESCE($1, name),
			type = COALESCE($2, type),
			updated_at = NOW()
		WHERE id = $3
	`, req.Name, req.Type, landingID)
	if err != nil {
		http.Error(w, "Failed to update landing", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Landing updated"})
}

// DeleteLanding deletes a landing and its files
func (h *LandingsHandler) DeleteLanding(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	landingID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid landing ID", http.StatusBadRequest)
		return
	}

	// Get landing info
	var landing models.Landing
	err = h.db.Get(&landing, "SELECT * FROM landings WHERE id = $1", landingID)
	if err != nil {
		http.Error(w, "Landing not found", http.StatusNotFound)
		return
	}

	// Check ownership
	if landing.OwnerID != userID && !claims.IsSuperAdmin() {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	// Delete files
	if landing.StoragePath != "" {
		os.Remove(landing.StoragePath)
	}
	if landing.PreviewPath != nil && *landing.PreviewPath != "" {
		// Extract token from preview path
		parts := strings.Split(*landing.PreviewPath, "/")
		for i, p := range parts {
			if p == "preview" && i+1 < len(parts) {
				previewDir := filepath.Join(PreviewBaseDir, parts[i+1])
				os.RemoveAll(previewDir)
				break
			}
		}
	}

	// Delete from database
	_, err = h.db.Exec("DELETE FROM landings WHERE id = $1", landingID)
	if err != nil {
		http.Error(w, "Failed to delete landing", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// DownloadLanding allows downloading the original zip file
func (h *LandingsHandler) DownloadLanding(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	landingID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid landing ID", http.StatusBadRequest)
		return
	}

	var landing models.Landing
	err = h.db.Get(&landing, "SELECT * FROM landings WHERE id = $1", landingID)
	if err != nil {
		http.Error(w, "Landing not found", http.StatusNotFound)
		return
	}

	// Check access
	if landing.OwnerID != userID && !claims.IsSuperAdmin() {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", landing.FileName))
	w.Header().Set("Content-Type", "application/zip")
	http.ServeFile(w, r, landing.StoragePath)
}

// AgentDownloadLanding allows agents to download landing files (uses agent auth via API key)
func (h *LandingsHandler) AgentDownloadLanding(w http.ResponseWriter, r *http.Request) {
	landingID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid landing ID", http.StatusBadRequest)
		return
	}

	var landing models.Landing
	err = h.db.Get(&landing, "SELECT * FROM landings WHERE id = $1", landingID)
	if err != nil {
		http.Error(w, "Landing not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", landing.FileName))
	w.Header().Set("Content-Type", "application/zip")
	http.ServeFile(w, r, landing.StoragePath)
}

// Helper functions
func generateRandomToken(length int) string {
	b := make([]byte, length)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func isAlphanumeric(s string) bool {
	for _, r := range s {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
}

