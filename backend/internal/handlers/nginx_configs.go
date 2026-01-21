package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/database"
	"configuratix/backend/internal/models"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

type NginxConfigsHandler struct {
	db *database.DB
}

func NewNginxConfigsHandler(db *database.DB) *NginxConfigsHandler {
	return &NginxConfigsHandler{db: db}
}

// ListNginxConfigs returns all nginx configs
func (h *NginxConfigsHandler) ListNginxConfigs(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var configs []models.NginxConfig
	var err error

	if claims.IsSuperAdmin() {
		err = h.db.Select(&configs, `
			SELECT * FROM nginx_configs
			ORDER BY created_at DESC
		`)
	} else {
		err = h.db.Select(&configs, `
			SELECT * FROM nginx_configs
			WHERE owner_id = $1 OR owner_id IS NULL
			ORDER BY created_at DESC
		`, userID)
	}
	if err != nil {
		log.Printf("Failed to list nginx configs: %v", err)
		http.Error(w, "Failed to list nginx configs", http.StatusInternalServerError)
		return
	}

	if configs == nil {
		configs = []models.NginxConfig{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(configs)
}

// GetNginxConfig returns a single nginx config by ID
func (h *NginxConfigsHandler) GetNginxConfig(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid config ID", http.StatusBadRequest)
		return
	}

	var config models.NginxConfig
	err = h.db.Get(&config, "SELECT * FROM nginx_configs WHERE id = $1", id)
	if err != nil {
		http.Error(w, "Config not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

type CreateNginxConfigRequest struct {
	Name           string                       `json:"name"`
	Mode           string                       `json:"mode"`
	StructuredJSON *models.NginxConfigStructured `json:"structured_json"`
	RawText        *string                      `json:"raw_text"`
}

// CreateNginxConfig creates a new nginx config
func (h *NginxConfigsHandler) CreateNginxConfig(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req CreateNginxConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}

	if req.Mode == "" {
		req.Mode = "auto"
	}

	var structuredJSON []byte
	var err error
	if req.StructuredJSON != nil {
		structuredJSON, err = json.Marshal(req.StructuredJSON)
		if err != nil {
			http.Error(w, "Invalid structured config", http.StatusBadRequest)
			return
		}
	}

	var config models.NginxConfig
	err = h.db.Get(&config, `
		INSERT INTO nginx_configs (name, owner_id, mode, structured_json, raw_text)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING *
	`, req.Name, userID, req.Mode, structuredJSON, req.RawText)
	if err != nil {
		log.Printf("Failed to create nginx config: %v", err)
		http.Error(w, "Failed to create nginx config", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(config)
}

type UpdateNginxConfigRequest struct {
	Name           *string                      `json:"name"`
	Mode           *string                      `json:"mode"`
	StructuredJSON *models.NginxConfigStructured `json:"structured_json"`
	RawText        *string                      `json:"raw_text"`
}

// UpdateNginxConfig updates an existing nginx config
func (h *NginxConfigsHandler) UpdateNginxConfig(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid config ID", http.StatusBadRequest)
		return
	}

	var req UpdateNginxConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Get existing config
	var existing models.NginxConfig
	err = h.db.Get(&existing, "SELECT * FROM nginx_configs WHERE id = $1", id)
	if err != nil {
		http.Error(w, "Config not found", http.StatusNotFound)
		return
	}

	// Update fields
	name := existing.Name
	if req.Name != nil {
		name = *req.Name
	}

	mode := existing.Mode
	if req.Mode != nil {
		mode = *req.Mode
	}

	var structuredJSON []byte
	if req.StructuredJSON != nil {
		structuredJSON, err = json.Marshal(req.StructuredJSON)
		if err != nil {
			http.Error(w, "Invalid structured config", http.StatusBadRequest)
			return
		}
	} else {
		structuredJSON = existing.StructuredJSON
	}

	rawText := existing.RawText
	if req.RawText != nil {
		rawText = req.RawText
	}

	var config models.NginxConfig
	err = h.db.Get(&config, `
		UPDATE nginx_configs 
		SET name = $1, mode = $2, structured_json = $3, raw_text = $4, updated_at = NOW()
		WHERE id = $5
		RETURNING *
	`, name, mode, structuredJSON, rawText, id)
	if err != nil {
		log.Printf("Failed to update nginx config: %v", err)
		http.Error(w, "Failed to update nginx config", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

// DeleteNginxConfig deletes an nginx config
func (h *NginxConfigsHandler) DeleteNginxConfig(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid config ID", http.StatusBadRequest)
		return
	}

	_, err = h.db.Exec("DELETE FROM nginx_configs WHERE id = $1", id)
	if err != nil {
		log.Printf("Failed to delete nginx config: %v", err)
		http.Error(w, "Failed to delete nginx config", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// GenerateNginxConfig generates raw nginx config from structured form
func GenerateNginxConfig(structured *models.NginxConfigStructured, domain string) string {
	config := "server {\n"
	config += "    listen 80;\n"
	
	if structured.SSLMode != "disabled" {
		config += "    listen 443 ssl;\n"
	}
	
	config += "    server_name " + domain + ";\n\n"

	// SSL configuration
	if structured.SSLMode != "disabled" {
		config += "    ssl_certificate /etc/letsencrypt/live/" + domain + "/fullchain.pem;\n"
		config += "    ssl_certificate_key /etc/letsencrypt/live/" + domain + "/privkey.pem;\n\n"

		if structured.SSLMode == "redirect_https" {
			config += "    if ($scheme != \"https\") {\n"
			config += "        return 301 https://$host$request_uri;\n"
			config += "    }\n\n"
		}
	}

	// CORS configuration
	if structured.CORS != nil && structured.CORS.Enabled {
		if structured.CORS.AllowAll {
			config += "    add_header 'Access-Control-Allow-Origin' '*' always;\n"
			config += "    add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;\n"
			config += "    add_header 'Access-Control-Allow-Headers' '*' always;\n\n"
		}
	}

	// Locations
	for _, loc := range structured.Locations {
		config += "    location " + loc.Path + " {\n"
		
		if loc.Type == "proxy" && loc.ProxyURL != "" {
			config += "        proxy_pass " + loc.ProxyURL + ";\n"
			config += "        proxy_set_header Host $host;\n"
			config += "        proxy_set_header X-Real-IP $remote_addr;\n"
			config += "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
			config += "        proxy_set_header X-Forwarded-Proto $scheme;\n"
		} else if loc.Type == "static" {
			if loc.Root != "" {
				config += "        root " + loc.Root + ";\n"
			}
			if loc.Index != "" {
				config += "        index " + loc.Index + ";\n"
			}
			config += "        try_files $uri $uri/ =404;\n"
		}
		
		config += "    }\n\n"
	}

	config += "}\n"
	return config
}

