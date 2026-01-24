package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/database"
	"configuratix/backend/internal/models"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

type SecurityHandler struct {
	db *database.DB
}

func NewSecurityHandler(db *database.DB) *SecurityHandler {
	return &SecurityHandler{db: db}
}

// ============================================================
// IP Bans
// ============================================================

// ListBans returns paginated list of banned IPs
func (h *SecurityHandler) ListBans(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	// Parse pagination
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}
	offset := (page - 1) * pageSize

	// Parse filters
	search := r.URL.Query().Get("search")
	reason := r.URL.Query().Get("reason")
	machineID := r.URL.Query().Get("machine_id")
	activeOnly := r.URL.Query().Get("active_only") == "true"

	// Build query
	baseQuery := `
		FROM security_ip_bans b
		LEFT JOIN machines m ON b.source_machine_id = m.id
		LEFT JOIN users u ON b.created_by = u.id
		WHERE EXISTS (
			SELECT 1 FROM machines WHERE owner_id = $1
		)
	`
	args := []interface{}{userID}
	argNum := 2

	if search != "" {
		baseQuery += fmt.Sprintf(" AND b.ip_address::text LIKE $%d", argNum)
		args = append(args, "%"+search+"%")
		argNum++
	}
	if reason != "" {
		baseQuery += fmt.Sprintf(" AND b.reason = $%d", argNum)
		args = append(args, reason)
		argNum++
	}
	if machineID != "" {
		baseQuery += fmt.Sprintf(" AND b.source_machine_id = $%d", argNum)
		args = append(args, machineID)
		argNum++
	}
	if activeOnly {
		baseQuery += " AND b.is_active = true AND (b.expires_at IS NULL OR b.expires_at > NOW())"
	}

	// Get total count
	var total int
	countQuery := "SELECT COUNT(*) " + baseQuery
	err := h.db.Get(&total, countQuery, args...)
	if err != nil {
		log.Printf("Failed to count bans: %v", err)
		http.Error(w, "Failed to list bans", http.StatusInternalServerError)
		return
	}

	// Get page data
	selectQuery := `
		SELECT 
			b.*,
			COALESCE(NULLIF(m.title, ''), m.hostname, '') as source_machine_name,
			COALESCE(u.email, '') as created_by_email
	` + baseQuery + fmt.Sprintf(" ORDER BY b.banned_at DESC LIMIT $%d OFFSET $%d", argNum, argNum+1)
	args = append(args, pageSize, offset)

	var bans []models.SecurityIPBanWithDetails
	err = h.db.Select(&bans, selectQuery, args...)
	if err != nil {
		log.Printf("Failed to list bans: %v", err)
		http.Error(w, "Failed to list bans", http.StatusInternalServerError)
		return
	}

	if bans == nil {
		bans = []models.SecurityIPBanWithDetails{}
	}

	totalPages := (total + pageSize - 1) / pageSize

	response := models.BanListPage{
		Bans:       bans,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// CreateBan manually bans an IP
func (h *SecurityHandler) CreateBan(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req models.CreateBanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate IP
	if net.ParseIP(req.IPAddress) == nil {
		http.Error(w, "Invalid IP address", http.StatusBadRequest)
		return
	}

	// Check if whitelisted
	var whitelisted bool
	err := h.db.Get(&whitelisted, `
		SELECT EXISTS(
			SELECT 1 FROM security_ip_whitelist 
			WHERE owner_id = $1 AND $2::inet <<= ip_cidr
		)
	`, userID, req.IPAddress)
	if err == nil && whitelisted {
		http.Error(w, "IP is whitelisted and cannot be banned", http.StatusBadRequest)
		return
	}

	// Check if already banned
	var existingID uuid.UUID
	err = h.db.Get(&existingID, `
		SELECT id FROM security_ip_bans 
		WHERE ip_address = $1 AND is_active = true
	`, req.IPAddress)
	if err == nil {
		http.Error(w, "IP is already banned", http.StatusConflict)
		return
	}

	// Calculate expiry
	expiryDays := 30
	if req.ExpiresInDays > 0 {
		expiryDays = req.ExpiresInDays
	}

	details := req.Details
	if details == nil {
		details = json.RawMessage("{}")
	}

	reason := req.Reason
	if reason == "" {
		reason = "manual"
	}

	// Insert ban
	var ban models.SecurityIPBan
	err = h.db.Get(&ban, `
		INSERT INTO security_ip_bans (ip_address, reason, details, created_by, expires_at)
		VALUES ($1, $2, $3, $4, NOW() + ($5 || ' days')::interval)
		RETURNING *
	`, req.IPAddress, reason, details, userID, strconv.Itoa(expiryDays))
	if err != nil {
		log.Printf("Failed to create ban: %v", err)
		http.Error(w, "Failed to create ban", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(ban)
}

// ImportBans imports multiple IPs from text list
func (h *SecurityHandler) ImportBans(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req models.ImportBansRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.IPs) == 0 {
		http.Error(w, "No IPs provided", http.StatusBadRequest)
		return
	}

	reason := req.Reason
	if reason == "" {
		reason = "imported"
	}

	// Get whitelist for this user
	var whitelist []string
	h.db.Select(&whitelist, `SELECT ip_cidr::text FROM security_ip_whitelist WHERE owner_id = $1`, userID)

	// Get already banned IPs
	var existingBans []string
	h.db.Select(&existingBans, `SELECT ip_address::text FROM security_ip_bans WHERE is_active = true`)
	existingMap := make(map[string]bool)
	for _, ip := range existingBans {
		existingMap[ip] = true
	}

	result := models.ImportBansResponse{}
	var toInsert []string

	for _, ipStr := range req.IPs {
		ipStr = strings.TrimSpace(ipStr)
		if ipStr == "" {
			continue
		}

		// Validate IP
		ip := net.ParseIP(ipStr)
		if ip == nil {
			result.Invalid++
			continue
		}

		// Check whitelist
		isWhitelisted := false
		for _, wl := range whitelist {
			_, cidr, err := net.ParseCIDR(wl)
			if err != nil {
				// It's a single IP
				if wl == ipStr {
					isWhitelisted = true
					break
				}
			} else {
				if cidr.Contains(ip) {
					isWhitelisted = true
					break
				}
			}
		}
		if isWhitelisted {
			result.SkippedWhitelist++
			result.SkippedIPs = append(result.SkippedIPs, ipStr)
			continue
		}

		// Check already banned
		if existingMap[ipStr] {
			result.AlreadyBanned++
			continue
		}

		toInsert = append(toInsert, ipStr)
	}

	// Bulk insert
	for _, ipStr := range toInsert {
		_, err := h.db.Exec(`
			INSERT INTO security_ip_bans (ip_address, reason, details, created_by)
			VALUES ($1, $2, '{}', $3)
			ON CONFLICT DO NOTHING
		`, ipStr, reason, userID)
		if err != nil {
			log.Printf("Failed to insert ban for %s: %v", ipStr, err)
			continue
		}
		result.Imported++
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// DeleteBan unbans a single IP
func (h *SecurityHandler) DeleteBan(w http.ResponseWriter, r *http.Request) {
	banID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid ban ID", http.StatusBadRequest)
		return
	}

	result, err := h.db.Exec(`
		UPDATE security_ip_bans 
		SET is_active = false, unbanned_at = NOW() 
		WHERE id = $1
	`, banID)
	if err != nil {
		log.Printf("Failed to delete ban: %v", err)
		http.Error(w, "Failed to unban", http.StatusInternalServerError)
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		http.Error(w, "Ban not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// DeleteAllBans unbans all IPs
func (h *SecurityHandler) DeleteAllBans(w http.ResponseWriter, r *http.Request) {
	result, err := h.db.Exec(`
		UPDATE security_ip_bans 
		SET is_active = false, unbanned_at = NOW() 
		WHERE is_active = true
	`)
	if err != nil {
		log.Printf("Failed to unban all: %v", err)
		http.Error(w, "Failed to unban all", http.StatusInternalServerError)
		return
	}

	rows, _ := result.RowsAffected()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int64{"unbanned": rows})
}

// ============================================================
// Whitelist
// ============================================================

// ListWhitelist returns all whitelisted IPs for user
func (h *SecurityHandler) ListWhitelist(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var whitelist []models.SecurityIPWhitelist
	err := h.db.Select(&whitelist, `
		SELECT * FROM security_ip_whitelist 
		WHERE owner_id = $1 
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		log.Printf("Failed to list whitelist: %v", err)
		http.Error(w, "Failed to list whitelist", http.StatusInternalServerError)
		return
	}

	if whitelist == nil {
		whitelist = []models.SecurityIPWhitelist{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(whitelist)
}

// CreateWhitelistEntry adds an IP to whitelist
func (h *SecurityHandler) CreateWhitelistEntry(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req models.CreateWhitelistRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate IP or CIDR
	ipStr := strings.TrimSpace(req.IPCIDR)
	if _, _, err := net.ParseCIDR(ipStr); err != nil {
		// Not CIDR, try single IP
		if net.ParseIP(ipStr) == nil {
			http.Error(w, "Invalid IP address or CIDR", http.StatusBadRequest)
			return
		}
		// Convert single IP to /32 CIDR
		ipStr = ipStr + "/32"
	}

	// Insert whitelist entry
	var entry models.SecurityIPWhitelist
	err := h.db.Get(&entry, `
		INSERT INTO security_ip_whitelist (owner_id, ip_cidr, description)
		VALUES ($1, $2, $3)
		RETURNING *
	`, userID, ipStr, req.Description)
	if err != nil {
		log.Printf("Failed to create whitelist entry: %v", err)
		http.Error(w, "Failed to create whitelist entry", http.StatusInternalServerError)
		return
	}

	// Deactivate any bans for this IP/CIDR
	h.db.Exec(`
		UPDATE security_ip_bans 
		SET is_active = false, unbanned_at = NOW()
		WHERE ip_address <<= $1 AND is_active = true
	`, ipStr)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(entry)
}

// DeleteWhitelistEntry removes from whitelist
func (h *SecurityHandler) DeleteWhitelistEntry(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	entryID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid entry ID", http.StatusBadRequest)
		return
	}

	result, err := h.db.Exec(`
		DELETE FROM security_ip_whitelist 
		WHERE id = $1 AND owner_id = $2
	`, entryID, userID)
	if err != nil {
		log.Printf("Failed to delete whitelist entry: %v", err)
		http.Error(w, "Failed to delete", http.StatusInternalServerError)
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		http.Error(w, "Entry not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ============================================================
// UA Patterns
// ============================================================

// ListUAPatterns returns patterns grouped by category
func (h *SecurityHandler) ListUAPatterns(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	// Get all patterns (system + user's custom)
	var patterns []models.SecurityUAPattern
	err := h.db.Select(&patterns, `
		SELECT * FROM security_ua_patterns 
		WHERE owner_id IS NULL OR owner_id = $1
		ORDER BY category, is_system DESC, pattern
	`, userID)
	if err != nil {
		log.Printf("Failed to list UA patterns: %v", err)
		http.Error(w, "Failed to list patterns", http.StatusInternalServerError)
		return
	}

	// Get user's category settings
	var categorySettings []models.SecurityUACategory
	h.db.Select(&categorySettings, `
		SELECT * FROM security_ua_categories WHERE owner_id = $1
	`, userID)
	categoryEnabled := make(map[string]bool)
	for _, cs := range categorySettings {
		categoryEnabled[cs.Category] = cs.IsEnabled
	}

	// Group by category
	categoryMap := make(map[string]*models.UAPatternsByCategory)
	for _, p := range patterns {
		if _, ok := categoryMap[p.Category]; !ok {
			enabled, exists := categoryEnabled[p.Category]
			if !exists {
				enabled = true // Default enabled
			}
			categoryMap[p.Category] = &models.UAPatternsByCategory{
				Category:  p.Category,
				IsEnabled: enabled,
				Patterns:  []models.SecurityUAPattern{},
			}
		}
		categoryMap[p.Category].Patterns = append(categoryMap[p.Category].Patterns, p)
		categoryMap[p.Category].PatternCount++
	}

	result := make([]models.UAPatternsByCategory, 0, len(categoryMap))
	for _, cat := range categoryMap {
		result = append(result, *cat)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// CreateUAPattern adds a custom UA pattern
func (h *SecurityHandler) CreateUAPattern(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req models.CreateUAPatternRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Pattern == "" {
		http.Error(w, "Pattern is required", http.StatusBadRequest)
		return
	}

	matchType := req.MatchType
	if matchType == "" {
		matchType = "contains"
	}

	category := req.Category
	if category == "" {
		category = "custom"
	}

	var pattern models.SecurityUAPattern
	err := h.db.Get(&pattern, `
		INSERT INTO security_ua_patterns (owner_id, category, pattern, match_type, description, is_system)
		VALUES ($1, $2, $3, $4, $5, false)
		RETURNING *
	`, userID, category, req.Pattern, matchType, req.Description)
	if err != nil {
		log.Printf("Failed to create UA pattern: %v", err)
		http.Error(w, "Failed to create pattern", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(pattern)
}

// DeleteUAPattern removes a custom pattern (system patterns cannot be deleted)
func (h *SecurityHandler) DeleteUAPattern(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	patternID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid pattern ID", http.StatusBadRequest)
		return
	}

	result, err := h.db.Exec(`
		DELETE FROM security_ua_patterns 
		WHERE id = $1 AND owner_id = $2 AND is_system = false
	`, patternID, userID)
	if err != nil {
		log.Printf("Failed to delete UA pattern: %v", err)
		http.Error(w, "Failed to delete", http.StatusInternalServerError)
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		http.Error(w, "Pattern not found or cannot be deleted", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ToggleUACategory enables/disables a category for user
func (h *SecurityHandler) ToggleUACategory(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	category := mux.Vars(r)["category"]

	var req models.ToggleUACategoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	_, err := h.db.Exec(`
		INSERT INTO security_ua_categories (owner_id, category, is_enabled, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (owner_id, category) 
		DO UPDATE SET is_enabled = $3, updated_at = NOW()
	`, userID, category, req.IsEnabled)
	if err != nil {
		log.Printf("Failed to toggle UA category: %v", err)
		http.Error(w, "Failed to toggle category", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ============================================================
// Security Config Settings (per nginx config)
// ============================================================

// GetSecuritySettings gets security settings for a nginx config
func (h *SecurityHandler) GetSecuritySettings(w http.ResponseWriter, r *http.Request) {
	configID, err := uuid.Parse(mux.Vars(r)["configId"])
	if err != nil {
		http.Error(w, "Invalid config ID", http.StatusBadRequest)
		return
	}

	var settings models.SecurityConfigSettings
	err = h.db.Get(&settings, `
		SELECT * FROM security_config_settings WHERE nginx_config_id = $1
	`, configID)
	if err == sql.ErrNoRows {
		// Return defaults
		settings = models.SecurityConfigSettings{
			NginxConfigID:           configID,
			UABlockingEnabled:       false,
			EndpointBlockingEnabled: false,
			SyncEnabled:             true,
			SyncIntervalMinutes:     2,
		}
	} else if err != nil {
		log.Printf("Failed to get security settings: %v", err)
		http.Error(w, "Failed to get settings", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}

// UpdateSecuritySettings updates security settings for a nginx config
func (h *SecurityHandler) UpdateSecuritySettings(w http.ResponseWriter, r *http.Request) {
	configID, err := uuid.Parse(mux.Vars(r)["configId"])
	if err != nil {
		http.Error(w, "Invalid config ID", http.StatusBadRequest)
		return
	}

	var req models.UpdateSecurityConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Upsert settings
	_, err = h.db.Exec(`
		INSERT INTO security_config_settings (nginx_config_id, ua_blocking_enabled, endpoint_blocking_enabled, sync_enabled, sync_interval_minutes)
		VALUES ($1, COALESCE($2, false), COALESCE($3, false), COALESCE($4, true), COALESCE($5, 2))
		ON CONFLICT (nginx_config_id) DO UPDATE SET
			ua_blocking_enabled = COALESCE($2, security_config_settings.ua_blocking_enabled),
			endpoint_blocking_enabled = COALESCE($3, security_config_settings.endpoint_blocking_enabled),
			sync_enabled = COALESCE($4, security_config_settings.sync_enabled),
			sync_interval_minutes = COALESCE($5, security_config_settings.sync_interval_minutes),
			updated_at = NOW()
	`, configID, req.UABlockingEnabled, req.EndpointBlockingEnabled, req.SyncEnabled, req.SyncIntervalMinutes)
	if err != nil {
		log.Printf("Failed to update security settings: %v", err)
		http.Error(w, "Failed to update settings", http.StatusInternalServerError)
		return
	}

	// Return updated settings
	h.GetSecuritySettings(w, r)
}

// ============================================================
// Endpoint Rules
// ============================================================

// ListEndpointRules lists allowed path patterns for a config
func (h *SecurityHandler) ListEndpointRules(w http.ResponseWriter, r *http.Request) {
	configID, err := uuid.Parse(mux.Vars(r)["configId"])
	if err != nil {
		http.Error(w, "Invalid config ID", http.StatusBadRequest)
		return
	}

	var rules []models.SecurityEndpointRule
	err = h.db.Select(&rules, `
		SELECT * FROM security_endpoint_rules 
		WHERE nginx_config_id = $1 
		ORDER BY priority DESC, created_at
	`, configID)
	if err != nil {
		log.Printf("Failed to list endpoint rules: %v", err)
		http.Error(w, "Failed to list rules", http.StatusInternalServerError)
		return
	}

	if rules == nil {
		rules = []models.SecurityEndpointRule{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(rules)
}

// CreateEndpointRule adds an allowed path pattern
func (h *SecurityHandler) CreateEndpointRule(w http.ResponseWriter, r *http.Request) {
	configID, err := uuid.Parse(mux.Vars(r)["configId"])
	if err != nil {
		http.Error(w, "Invalid config ID", http.StatusBadRequest)
		return
	}

	var req models.CreateEndpointRuleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Pattern == "" {
		http.Error(w, "Pattern is required", http.StatusBadRequest)
		return
	}

	var rule models.SecurityEndpointRule
	err = h.db.Get(&rule, `
		INSERT INTO security_endpoint_rules (nginx_config_id, pattern, description, priority)
		VALUES ($1, $2, $3, $4)
		RETURNING *
	`, configID, req.Pattern, req.Description, req.Priority)
	if err != nil {
		log.Printf("Failed to create endpoint rule: %v", err)
		http.Error(w, "Failed to create rule", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(rule)
}

// DeleteEndpointRule removes an endpoint rule
func (h *SecurityHandler) DeleteEndpointRule(w http.ResponseWriter, r *http.Request) {
	ruleID, err := uuid.Parse(mux.Vars(r)["ruleId"])
	if err != nil {
		http.Error(w, "Invalid rule ID", http.StatusBadRequest)
		return
	}

	result, err := h.db.Exec(`DELETE FROM security_endpoint_rules WHERE id = $1`, ruleID)
	if err != nil {
		log.Printf("Failed to delete endpoint rule: %v", err)
		http.Error(w, "Failed to delete", http.StatusInternalServerError)
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		http.Error(w, "Rule not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ============================================================
// Machine Security Settings
// ============================================================

// GetMachineSecuritySettings gets security settings for a machine
func (h *SecurityHandler) GetMachineSecuritySettings(w http.ResponseWriter, r *http.Request) {
	machineID, err := uuid.Parse(mux.Vars(r)["machineId"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	var settings models.SecurityMachineSettings
	err = h.db.Get(&settings, `
		SELECT * FROM security_machine_settings WHERE machine_id = $1
	`, machineID)
	if err == sql.ErrNoRows {
		// Return defaults
		settings = models.SecurityMachineSettings{
			MachineID:       machineID,
			NftablesEnabled: false,
			BanCount:        0,
		}
	} else if err != nil {
		log.Printf("Failed to get machine security settings: %v", err)
		http.Error(w, "Failed to get settings", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}

// UpdateMachineSecuritySettings updates security settings for a machine
func (h *SecurityHandler) UpdateMachineSecuritySettings(w http.ResponseWriter, r *http.Request) {
	machineID, err := uuid.Parse(mux.Vars(r)["machineId"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	var req models.UpdateMachineSecurityRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	_, err = h.db.Exec(`
		INSERT INTO security_machine_settings (machine_id, nftables_enabled)
		VALUES ($1, COALESCE($2, false))
		ON CONFLICT (machine_id) DO UPDATE SET
			nftables_enabled = COALESCE($2, security_machine_settings.nftables_enabled),
			updated_at = NOW()
	`, machineID, req.NftablesEnabled)
	if err != nil {
		log.Printf("Failed to update machine security settings: %v", err)
		http.Error(w, "Failed to update settings", http.StatusInternalServerError)
		return
	}

	h.GetMachineSecuritySettings(w, r)
}

// ============================================================
// Stats
// ============================================================

// GetSecurityStats returns global security statistics
func (h *SecurityHandler) GetSecurityStats(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	stats := models.SecurityStats{}

	// Total and active bans
	h.db.Get(&stats.TotalBans, `SELECT COUNT(*) FROM security_ip_bans`)
	h.db.Get(&stats.ActiveBans, `SELECT COUNT(*) FROM security_ip_bans WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW())`)

	// Bans today
	h.db.Get(&stats.BansToday, `SELECT COUNT(*) FROM security_ip_bans WHERE banned_at > NOW() - INTERVAL '1 day'`)

	// Bans this week
	h.db.Get(&stats.BansThisWeek, `SELECT COUNT(*) FROM security_ip_bans WHERE banned_at > NOW() - INTERVAL '7 days'`)

	// Top reasons
	h.db.Select(&stats.TopReasons, `
		SELECT reason, COUNT(*) as count 
		FROM security_ip_bans 
		WHERE is_active = true
		GROUP BY reason 
		ORDER BY count DESC 
		LIMIT 5
	`)

	// Top machines
	h.db.Select(&stats.TopMachines, `
		SELECT b.source_machine_id as machine_id, 
			   COALESCE(NULLIF(m.title, ''), m.hostname, 'Unknown') as machine_name,
			   COUNT(*) as count 
		FROM security_ip_bans b
		LEFT JOIN machines m ON b.source_machine_id = m.id
		WHERE b.is_active = true AND b.source_machine_id IS NOT NULL
		GROUP BY b.source_machine_id, m.title, m.hostname
		ORDER BY count DESC 
		LIMIT 5
	`)

	// Whitelist count
	h.db.Get(&stats.WhitelistCount, `SELECT COUNT(*) FROM security_ip_whitelist WHERE owner_id = $1`, userID)

	// UA pattern count
	h.db.Get(&stats.UAPatternCount, `SELECT COUNT(*) FROM security_ua_patterns WHERE owner_id IS NULL OR owner_id = $1`, userID)

	if stats.TopReasons == nil {
		stats.TopReasons = []models.ReasonCount{}
	}
	if stats.TopMachines == nil {
		stats.TopMachines = []models.MachineCount{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

// ============================================================
// Agent Endpoints
// ============================================================

// AgentSecuritySync handles bidirectional sync from agents
func (h *SecurityHandler) AgentSecuritySync(w http.ResponseWriter, r *http.Request) {
	agentID := r.Context().Value("agent_id").(uuid.UUID)

	// Get machine ID from agent (machines.agent_id -> agents.id)
	var machineID uuid.UUID
	err := h.db.Get(&machineID, `SELECT id FROM machines WHERE agent_id = $1`, agentID)
	if err != nil {
		log.Printf("Agent %s has no associated machine: %v", agentID, err)
		http.Error(w, "Agent not found", http.StatusUnauthorized)
		return
	}

	var req models.AgentSecuritySyncRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Get machine owner
	var ownerID uuid.UUID
	h.db.Get(&ownerID, `SELECT owner_id FROM machines WHERE id = $1`, machineID)

	// Process new bans from agent
	for _, ban := range req.NewBans {
		// Check whitelist
		var whitelisted bool
		h.db.Get(&whitelisted, `
			SELECT EXISTS(
				SELECT 1 FROM security_ip_whitelist 
				WHERE owner_id = $1 AND $2::inet <<= ip_cidr
			)
		`, ownerID, ban.IPAddress)
		if whitelisted {
			log.Printf("Skipping whitelisted IP: %s", ban.IPAddress)
			continue
		}

		// Insert ban with expiry (ignore duplicates)
		expiresAt := time.Now().Add(30 * 24 * time.Hour) // 30 day default
		if ban.ExpiresAt != nil {
			expiresAt = *ban.ExpiresAt
		}
		_, err := h.db.Exec(`
			INSERT INTO security_ip_bans (ip_address, source_machine_id, reason, details, banned_at, expires_at, is_active)
			VALUES ($1, $2, $3, $4, $5, $6, true)
			ON CONFLICT (ip_address) DO UPDATE SET
				is_active = true,
				expires_at = $6,
				updated_at = NOW()
		`, ban.IPAddress, machineID, ban.Reason, ban.Details, ban.BannedAt, expiresAt)
		if err != nil {
			log.Printf("Failed to insert ban for %s: %v", ban.IPAddress, err)
		} else {
			log.Printf("Banned IP %s from agent (reason: %s)", ban.IPAddress, ban.Reason)
		}
	}

	// Update machine's last sync and ban count
	h.db.Exec(`
		INSERT INTO security_machine_settings (machine_id, last_sync_at, ban_count)
		VALUES ($1, NOW(), $2)
		ON CONFLICT (machine_id) DO UPDATE SET
			last_sync_at = NOW(),
			ban_count = $2,
			updated_at = NOW()
	`, machineID, req.BanCount)

	// Get bans agent is missing (since last sync)
	var missingBans []models.AgentBanEntry
	lastSync := req.LastSyncAt
	if lastSync == nil {
		t := time.Now().Add(-24 * time.Hour) // Default to last 24 hours on first sync
		lastSync = &t
	}

	h.db.Select(&missingBans, `
		SELECT ip_address, expires_at
		FROM security_ip_bans
		WHERE is_active = true 
		AND banned_at > $1
		AND (expires_at IS NULL OR expires_at > NOW())
	`, lastSync)

	// Get IPs to remove (whitelisted or expired)
	var bansToRemove []string
	// Get whitelist IPs
	h.db.Select(&bansToRemove, `
		SELECT ip_cidr::text FROM security_ip_whitelist WHERE owner_id = $1
	`, ownerID)

	// Add expired bans
	var expiredBans []string
	h.db.Select(&expiredBans, `
		SELECT ip_address::text FROM security_ip_bans 
		WHERE is_active = false OR (expires_at IS NOT NULL AND expires_at <= NOW())
	`)
	bansToRemove = append(bansToRemove, expiredBans...)

	// Get full whitelist for agent
	var whitelist []string
	h.db.Select(&whitelist, `SELECT ip_cidr::text FROM security_ip_whitelist WHERE owner_id = $1`, ownerID)

	response := models.AgentSecuritySyncResponse{
		MissingBans:      missingBans,
		BansToRemove:     bansToRemove,
		WhitelistUpdated: true, // Always send whitelist for now
		Whitelist:        whitelist,
		PatternsUpdated:  false, // TODO: Track pattern updates
		NextSyncAt:       time.Now().Add(2 * time.Minute),
	}

	if missingBans == nil {
		response.MissingBans = []models.AgentBanEntry{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// AgentGetUAPatterns returns active UA patterns for agent
func (h *SecurityHandler) AgentGetUAPatterns(w http.ResponseWriter, r *http.Request) {
	agentID := r.Context().Value("agent_id").(uuid.UUID)

	// Get machine owner (machines.agent_id -> agents.id)
	var ownerID uuid.UUID
	err := h.db.Get(&ownerID, `
		SELECT m.owner_id FROM machines m 
		WHERE m.agent_id = $1
	`, agentID)
	if err != nil {
		log.Printf("Agent %s has no associated machine: %v", agentID, err)
		http.Error(w, "Agent not found", http.StatusUnauthorized)
		return
	}

	// Get enabled categories
	var enabledCategories []string
	h.db.Select(&enabledCategories, `
		SELECT category FROM security_ua_categories 
		WHERE owner_id = $1 AND is_enabled = true
	`, ownerID)

	// If no explicit settings, all categories are enabled
	var patterns []string
	if len(enabledCategories) == 0 {
		// All system patterns
		h.db.Select(&patterns, `
			SELECT pattern FROM security_ua_patterns 
			WHERE (owner_id IS NULL OR owner_id = $1) AND is_active = true
		`, ownerID)
	} else {
		// Only enabled categories
		query := `
			SELECT pattern FROM security_ua_patterns 
			WHERE (owner_id IS NULL OR owner_id = $1) 
			AND is_active = true 
			AND category = ANY($2)
		`
		h.db.Select(&patterns, query, ownerID, enabledCategories)
	}

	if patterns == nil {
		patterns = []string{}
	}

	response := models.AgentUAPatternsResponse{
		Patterns:  patterns,
		UpdatedAt: time.Now(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// AgentGetWhitelist returns whitelist for agent
func (h *SecurityHandler) AgentGetWhitelist(w http.ResponseWriter, r *http.Request) {
	agentID := r.Context().Value("agent_id").(uuid.UUID)

	// Get machine owner (machines.agent_id -> agents.id)
	var ownerID uuid.UUID
	err := h.db.Get(&ownerID, `
		SELECT m.owner_id FROM machines m 
		WHERE m.agent_id = $1
	`, agentID)
	if err != nil {
		log.Printf("Agent %s has no associated machine: %v", agentID, err)
		http.Error(w, "Agent not found", http.StatusUnauthorized)
		return
	}

	var whitelist []string
	h.db.Select(&whitelist, `SELECT ip_cidr::text FROM security_ip_whitelist WHERE owner_id = $1`, ownerID)

	if whitelist == nil {
		whitelist = []string{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(whitelist)
}

