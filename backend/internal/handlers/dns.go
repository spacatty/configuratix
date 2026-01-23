package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/database"
	"configuratix/backend/internal/dns"
	"configuratix/backend/internal/models"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/lib/pq"
)

type DNSHandler struct {
	db          *database.DB
	syncService *dns.SyncService
}

func NewDNSHandler(db *database.DB) *DNSHandler {
	return &DNSHandler{
		db:          db,
		syncService: dns.NewSyncService(),
	}
}

// ==================== DNS Accounts ====================

type DNSAccountResponse struct {
	ID        uuid.UUID `json:"id"`
	OwnerID   uuid.UUID `json:"owner_id"`
	Provider  string    `json:"provider"`
	Name      string    `json:"name"`
	IsDefault bool      `json:"is_default"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ListDNSAccounts returns all DNS accounts for the current user
func (h *DNSHandler) ListDNSAccounts(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var accounts []models.DNSAccount
	err := h.db.Select(&accounts, `
		SELECT * FROM dns_accounts 
		WHERE owner_id = $1 
		ORDER BY provider, name
	`, userID)
	if err != nil {
		log.Printf("Failed to list DNS accounts: %v", err)
		http.Error(w, "Failed to list accounts", http.StatusInternalServerError)
		return
	}

	// Convert to response (without api_token)
	response := make([]DNSAccountResponse, len(accounts))
	for i, acc := range accounts {
		response[i] = DNSAccountResponse{
			ID:        acc.ID,
			OwnerID:   acc.OwnerID,
			Provider:  acc.Provider,
			Name:      acc.Name,
			IsDefault: acc.IsDefault,
			CreatedAt: acc.CreatedAt,
			UpdatedAt: acc.UpdatedAt,
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

type CreateDNSAccountRequest struct {
	Provider  string  `json:"provider"`
	Name      string  `json:"name"`
	ApiID     *string `json:"api_id"` // Required for DNSPod
	ApiToken  string  `json:"api_token"`
	IsDefault bool    `json:"is_default"`
}

// CreateDNSAccount creates a new DNS provider account
func (h *DNSHandler) CreateDNSAccount(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req CreateDNSAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Provider != "dnspod" && req.Provider != "cloudflare" {
		http.Error(w, "Invalid provider. Must be 'dnspod' or 'cloudflare'", http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.ApiToken == "" {
		http.Error(w, "Name and api_token are required", http.StatusBadRequest)
		return
	}

	if req.Provider == "dnspod" && (req.ApiID == nil || *req.ApiID == "") {
		http.Error(w, "api_id is required for DNSPod", http.StatusBadRequest)
		return
	}

	// Validate credentials
	apiID := ""
	if req.ApiID != nil {
		apiID = *req.ApiID
	}
	provider, err := dns.NewProvider(req.Provider, apiID, req.ApiToken)
	if err != nil {
		http.Error(w, "Failed to create provider", http.StatusInternalServerError)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	if err := provider.ValidateCredentials(ctx); err != nil {
		http.Error(w, "Invalid credentials: "+err.Error(), http.StatusBadRequest)
		return
	}

	// If this is set as default, unset other defaults for same provider
	if req.IsDefault {
		h.db.Exec(`
			UPDATE dns_accounts 
			SET is_default = false 
			WHERE owner_id = $1 AND provider = $2
		`, userID, req.Provider)
	}

	var account models.DNSAccount
	err = h.db.Get(&account, `
		INSERT INTO dns_accounts (owner_id, provider, name, api_id, api_token, is_default)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING *
	`, userID, req.Provider, req.Name, req.ApiID, req.ApiToken, req.IsDefault)
	if err != nil {
		log.Printf("Failed to create DNS account: %v", err)
		http.Error(w, "Failed to create account", http.StatusInternalServerError)
		return
	}

	response := DNSAccountResponse{
		ID:        account.ID,
		OwnerID:   account.OwnerID,
		Provider:  account.Provider,
		Name:      account.Name,
		IsDefault: account.IsDefault,
		CreatedAt: account.CreatedAt,
		UpdatedAt: account.UpdatedAt,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(response)
}

// UpdateDNSAccount updates an existing DNS account
func (h *DNSHandler) UpdateDNSAccount(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	vars := mux.Vars(r)
	accountID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}

	var req struct {
		Name      *string `json:"name"`
		ApiID     *string `json:"api_id"`
		ApiToken  *string `json:"api_token"`
		IsDefault *bool   `json:"is_default"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Verify ownership
	var existing models.DNSAccount
	err = h.db.Get(&existing, "SELECT * FROM dns_accounts WHERE id = $1 AND owner_id = $2", accountID, userID)
	if err != nil {
		http.Error(w, "Account not found", http.StatusNotFound)
		return
	}

	// If updating credentials, validate them
	if req.ApiToken != nil {
		apiID := ""
		if req.ApiID != nil {
			apiID = *req.ApiID
		} else if existing.ApiID != nil {
			apiID = *existing.ApiID
		}

		provider, _ := dns.NewProvider(existing.Provider, apiID, *req.ApiToken)
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()

		if err := provider.ValidateCredentials(ctx); err != nil {
			http.Error(w, "Invalid credentials: "+err.Error(), http.StatusBadRequest)
			return
		}
	}

	// Handle default flag
	if req.IsDefault != nil && *req.IsDefault {
		h.db.Exec(`
			UPDATE dns_accounts 
			SET is_default = false 
			WHERE owner_id = $1 AND provider = $2 AND id != $3
		`, userID, existing.Provider, accountID)
	}

	// Build update query
	query := "UPDATE dns_accounts SET updated_at = NOW()"
	args := []interface{}{}
	argNum := 1

	if req.Name != nil {
		query += fmt.Sprintf(", name = $%d", argNum)
		args = append(args, *req.Name)
		argNum++
	}
	if req.ApiID != nil {
		query += fmt.Sprintf(", api_id = $%d", argNum)
		args = append(args, *req.ApiID)
		argNum++
	}
	if req.ApiToken != nil {
		query += fmt.Sprintf(", api_token = $%d", argNum)
		args = append(args, *req.ApiToken)
		argNum++
	}
	if req.IsDefault != nil {
		query += fmt.Sprintf(", is_default = $%d", argNum)
		args = append(args, *req.IsDefault)
		argNum++
	}

	query += fmt.Sprintf(" WHERE id = $%d AND owner_id = $%d", argNum, argNum+1)
	args = append(args, accountID, userID)

	_, err = h.db.Exec(query, args...)
	if err != nil {
		log.Printf("Failed to update DNS account: %v", err)
		http.Error(w, "Failed to update account", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Account updated"})
}

// DeleteDNSAccount deletes a DNS account
func (h *DNSHandler) DeleteDNSAccount(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	vars := mux.Vars(r)
	accountID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}

	// Check if any DNS managed domains use this account
	var count int
	h.db.Get(&count, "SELECT COUNT(*) FROM dns_managed_domains WHERE dns_account_id = $1", accountID)
	if count > 0 {
		http.Error(w, "Cannot delete account: DNS domains are using it", http.StatusBadRequest)
		return
	}

	result, err := h.db.Exec("DELETE FROM dns_accounts WHERE id = $1 AND owner_id = $2", accountID, userID)
	if err != nil {
		log.Printf("Failed to delete DNS account: %v", err)
		http.Error(w, "Failed to delete account", http.StatusInternalServerError)
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		http.Error(w, "Account not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// TestDNSAccount tests if credentials are valid
func (h *DNSHandler) TestDNSAccount(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	vars := mux.Vars(r)
	accountID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}

	var account models.DNSAccount
	err = h.db.Get(&account, "SELECT * FROM dns_accounts WHERE id = $1 AND owner_id = $2", accountID, userID)
	if err != nil {
		http.Error(w, "Account not found", http.StatusNotFound)
		return
	}

	apiID := ""
	if account.ApiID != nil {
		apiID = *account.ApiID
	}

	provider, _ := dns.NewProvider(account.Provider, apiID, account.ApiToken)
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	if err := provider.ValidateCredentials(ctx); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"valid":   false,
			"message": err.Error(),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"valid":   true,
		"message": "Credentials are valid",
	})
}

// GetExpectedNameservers returns the expected nameservers for a domain from a DNS account
func (h *DNSHandler) GetExpectedNameservers(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	vars := mux.Vars(r)
	accountID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}

	domain := r.URL.Query().Get("domain")
	if domain == "" {
		http.Error(w, "domain query parameter is required", http.StatusBadRequest)
		return
	}

	var account models.DNSAccount
	err = h.db.Get(&account, "SELECT * FROM dns_accounts WHERE id = $1 AND owner_id = $2", accountID, userID)
	if err != nil {
		http.Error(w, "Account not found", http.StatusNotFound)
		return
	}

	apiID := ""
	if account.ApiID != nil {
		apiID = *account.ApiID
	}

	provider, _ := dns.NewProvider(account.Provider, apiID, account.ApiToken)
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	// This will create the zone if it doesn't exist
	nameservers, err := provider.GetOrCreateZone(ctx, domain)
	if err != nil {
		log.Printf("Failed to get/create zone for %s: %v", domain, err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"found":       false,
			"nameservers": []string{},
			"message":     fmt.Sprintf("Failed to setup zone: %v", err),
			"provider":    account.Provider,
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"found":       true,
		"nameservers": nameservers,
		"message":     fmt.Sprintf("Point your domain to these %s nameservers", account.Provider),
		"provider":    account.Provider,
	})
}

// ==================== DNS Managed Domains ====================

// ListDNSManagedDomains returns all DNS managed domains for the current user
func (h *DNSHandler) ListDNSManagedDomains(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var domains []models.DNSManagedDomainWithAccount
	err := h.db.Select(&domains, `
		SELECT 
			d.*,
			a.name as dns_account_name,
			a.provider as dns_account_provider
		FROM dns_managed_domains d
		LEFT JOIN dns_accounts a ON d.dns_account_id = a.id
		WHERE d.owner_id = $1
		ORDER BY d.fqdn
	`, userID)
	if err != nil {
		log.Printf("Failed to list DNS managed domains: %v", err)
		http.Error(w, "Failed to list domains", http.StatusInternalServerError)
		return
	}

	if domains == nil {
		domains = []models.DNSManagedDomainWithAccount{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(domains)
}

// GetDNSManagedDomain gets a single DNS managed domain by ID
func (h *DNSHandler) GetDNSManagedDomain(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	domainID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	var domain models.DNSManagedDomainWithAccount
	err = h.db.Get(&domain, `
		SELECT 
			d.*,
			a.name as dns_account_name,
			a.provider as dns_account_provider
		FROM dns_managed_domains d
		LEFT JOIN dns_accounts a ON d.dns_account_id = a.id
		WHERE d.id = $1 AND d.owner_id = $2
	`, domainID, userID)
	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "Domain not found", http.StatusNotFound)
			return
		}
		log.Printf("Failed to get DNS managed domain: %v", err)
		http.Error(w, "Failed to get domain", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(domain)
}

type CreateDNSManagedDomainRequest struct {
	FQDN         string  `json:"fqdn"`
	DNSAccountID *string `json:"dns_account_id"`
}

// CreateDNSManagedDomain adds a new domain for DNS management
func (h *DNSHandler) CreateDNSManagedDomain(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req CreateDNSManagedDomainRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.FQDN == "" {
		http.Error(w, "fqdn is required", http.StatusBadRequest)
		return
	}

	var dnsAccountID *uuid.UUID
	if req.DNSAccountID != nil && *req.DNSAccountID != "" {
		id, err := uuid.Parse(*req.DNSAccountID)
		if err != nil {
			http.Error(w, "Invalid dns_account_id", http.StatusBadRequest)
			return
		}
		dnsAccountID = &id
	}

	var domain models.DNSManagedDomain
	err := h.db.Get(&domain, `
		INSERT INTO dns_managed_domains (owner_id, fqdn, dns_account_id)
		VALUES ($1, $2, $3)
		RETURNING *
	`, userID, req.FQDN, dnsAccountID)
	if err != nil {
		log.Printf("Failed to create DNS managed domain: %v", err)
		http.Error(w, "Failed to create domain (may already exist)", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(domain)
}

type UpdateDNSManagedDomainRequest struct {
	DNSAccountID *string `json:"dns_account_id"` // Use string to detect null vs not-provided
	NotesMD      *string `json:"notes_md"`
}

// UpdateDNSManagedDomain updates DNS settings for a managed domain
func (h *DNSHandler) UpdateDNSManagedDomain(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	vars := mux.Vars(r)
	domainID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	var req UpdateDNSManagedDomainRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Build update query dynamically
	updates := []string{"updated_at = NOW()"}
	args := []interface{}{}
	argNum := 1

	// Handle dns_account_id - can be set to NULL explicitly
	if req.DNSAccountID != nil {
		if *req.DNSAccountID == "" {
			updates = append(updates, "dns_account_id = NULL")
		} else {
			accountID, err := uuid.Parse(*req.DNSAccountID)
			if err != nil {
				http.Error(w, "Invalid dns_account_id", http.StatusBadRequest)
				return
			}
			updates = append(updates, fmt.Sprintf("dns_account_id = $%d", argNum))
			args = append(args, accountID)
			argNum++
		}
	}
	if req.NotesMD != nil {
		updates = append(updates, fmt.Sprintf("notes_md = $%d", argNum))
		args = append(args, *req.NotesMD)
		argNum++
	}

	query := "UPDATE dns_managed_domains SET " + updates[0]
	for i := 1; i < len(updates); i++ {
		query += ", " + updates[i]
	}
	query += fmt.Sprintf(" WHERE id = $%d AND owner_id = $%d", argNum, argNum+1)
	args = append(args, domainID, userID)

	_, err = h.db.Exec(query, args...)
	if err != nil {
		log.Printf("Failed to update DNS managed domain: %v", err)
		http.Error(w, "Failed to update domain", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Domain updated"})
}

// DeleteDNSManagedDomain removes a domain from DNS management
func (h *DNSHandler) DeleteDNSManagedDomain(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	vars := mux.Vars(r)
	domainID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	result, err := h.db.Exec("DELETE FROM dns_managed_domains WHERE id = $1 AND owner_id = $2", domainID, userID)
	if err != nil {
		log.Printf("Failed to delete DNS managed domain: %v", err)
		http.Error(w, "Failed to delete domain", http.StatusInternalServerError)
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		http.Error(w, "Domain not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// CheckDomainNS checks nameserver status for a DNS managed domain
func (h *DNSHandler) CheckDomainNS(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	vars := mux.Vars(r)
	domainID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	// Get domain and its DNS account
	var domain models.DNSManagedDomain
	err = h.db.Get(&domain, "SELECT * FROM dns_managed_domains WHERE id = $1 AND owner_id = $2", domainID, userID)
	if err != nil {
		http.Error(w, "Domain not found", http.StatusNotFound)
		return
	}

	if domain.DNSAccountID == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(dns.NSStatus{
			Status:  "unknown",
			Message: "No DNS account configured",
		})
		return
	}

	// Get account credentials
	var account models.DNSAccount
	err = h.db.Get(&account, "SELECT * FROM dns_accounts WHERE id = $1", domain.DNSAccountID)
	if err != nil {
		http.Error(w, "DNS account not found", http.StatusNotFound)
		return
	}

	// Get expected nameservers from provider
	apiID := ""
	if account.ApiID != nil {
		apiID = *account.ApiID
	}
	provider, _ := dns.NewProvider(account.Provider, apiID, account.ApiToken)

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	expected, err := provider.GetExpectedNameservers(ctx, domain.FQDN)
	if err != nil {
		http.Error(w, "Failed to get expected nameservers: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Check current NS
	status := dns.CheckNameservers(domain.FQDN, expected)

	// Update domain with results
	h.db.Exec(`
		UPDATE dns_managed_domains 
		SET ns_status = $1, ns_last_check = NOW(), ns_expected = $2, ns_actual = $3
		WHERE id = $4
	`, status.Status, pq.Array(expected), pq.Array(status.Actual), domainID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

// ==================== DNS Records ====================

// ListDNSRecords returns all DNS records for a managed domain
func (h *DNSHandler) ListDNSRecords(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	vars := mux.Vars(r)
	domainID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	// Verify ownership
	var count int
	h.db.Get(&count, "SELECT COUNT(*) FROM dns_managed_domains WHERE id = $1 AND owner_id = $2", domainID, userID)
	if count == 0 {
		http.Error(w, "Domain not found", http.StatusNotFound)
		return
	}

	var records []models.DNSRecord
	err = h.db.Select(&records, `
		SELECT * FROM dns_records 
		WHERE dns_domain_id = $1 
		ORDER BY name, record_type
	`, domainID)
	if err != nil {
		log.Printf("Failed to list DNS records: %v", err)
		http.Error(w, "Failed to list records", http.StatusInternalServerError)
		return
	}

	if records == nil {
		records = []models.DNSRecord{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(records)
}

type CreateDNSRecordRequest struct {
	Name              string `json:"name"`
	RecordType        string `json:"record_type"`
	Value             string `json:"value"`
	TTL               int    `json:"ttl"`
	Priority          *int   `json:"priority"`
	Proxied           bool   `json:"proxied"`
	HTTPIncomingPort  *int   `json:"http_incoming_port"`
	HTTPOutgoingPort  *int   `json:"http_outgoing_port"`
	HTTPSIncomingPort *int   `json:"https_incoming_port"`
	HTTPSOutgoingPort *int   `json:"https_outgoing_port"`
}

// CreateDNSRecord creates a new DNS record
func (h *DNSHandler) CreateDNSRecord(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	vars := mux.Vars(r)
	domainID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	var req CreateDNSRecordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.RecordType == "" || req.Value == "" {
		http.Error(w, "name, record_type, and value are required", http.StatusBadRequest)
		return
	}

	ttl := req.TTL
	if ttl == 0 {
		ttl = 600
	}

	// Get domain and DNS account info
	var domain models.DNSManagedDomain
	err = h.db.Get(&domain, "SELECT * FROM dns_managed_domains WHERE id = $1 AND owner_id = $2", domainID, userID)
	if err != nil {
		http.Error(w, "Domain not found", http.StatusNotFound)
		return
	}

	// First, try to create on remote provider if account is set
	var remoteRecordID string
	syncStatus := "pending"
	var syncError string

	// Don't sync placeholder records (0.0.0.0) to provider - passthrough will handle it
	isPlaceholder := req.Value == "0.0.0.0"
	
	if domain.DNSAccountID != nil && !isPlaceholder {
		var account models.DNSAccount
		err = h.db.Get(&account, "SELECT * FROM dns_accounts WHERE id = $1", *domain.DNSAccountID)
		if err == nil {
			apiID := ""
			if account.ApiID != nil {
				apiID = *account.ApiID
			}
			provider, _ := dns.NewProvider(account.Provider, apiID, account.ApiToken)

			ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
			defer cancel()

			priority := 0
			if req.Priority != nil {
				priority = *req.Priority
			}
			remoteRecord, err := provider.CreateRecord(ctx, domain.FQDN, dns.Record{
				Name:     req.Name,
				Type:     req.RecordType,
				Value:    req.Value,
				TTL:      ttl,
				Priority: priority,
				Proxied:  req.Proxied,
			})

			if err != nil {
				log.Printf("Failed to create record on provider: %v", err)
				syncError = err.Error()
				syncStatus = "error"
			} else {
				remoteRecordID = remoteRecord.ID
				syncStatus = "synced"
			}
		}
	} else if isPlaceholder {
		// Placeholder for passthrough - will be synced when pool is created
		syncStatus = "pending"
	}

	// Save to database
	var record models.DNSRecord
	err = h.db.Get(&record, `
		INSERT INTO dns_records (
			dns_domain_id, name, record_type, value, ttl, priority, proxied,
			http_incoming_port, http_outgoing_port, https_incoming_port, https_outgoing_port,
			sync_status, sync_error, remote_record_id, last_synced_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 
			CASE WHEN $12 = 'synced' THEN NOW() ELSE NULL END)
		RETURNING *
	`, domainID, req.Name, req.RecordType, req.Value, ttl, req.Priority, req.Proxied,
		req.HTTPIncomingPort, req.HTTPOutgoingPort, req.HTTPSIncomingPort, req.HTTPSOutgoingPort,
		syncStatus, nullString(syncError), nullString(remoteRecordID))
	if err != nil {
		log.Printf("Failed to create DNS record: %v", err)
		http.Error(w, "Failed to create record (may already exist)", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(record)
}

// nullString returns nil for empty strings, used for nullable DB fields
func nullString(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// UpdateDNSRecord updates an existing DNS record
func (h *DNSHandler) UpdateDNSRecord(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	vars := mux.Vars(r)
	domainID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}
	recordID, err := uuid.Parse(vars["recordId"])
	if err != nil {
		http.Error(w, "Invalid record ID", http.StatusBadRequest)
		return
	}

	// Verify ownership
	var count int
	h.db.Get(&count, "SELECT COUNT(*) FROM dns_managed_domains WHERE id = $1 AND owner_id = $2", domainID, userID)
	if count == 0 {
		http.Error(w, "Domain not found", http.StatusNotFound)
		return
	}

	var req CreateDNSRecordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	_, err = h.db.Exec(`
		UPDATE dns_records SET
			name = $1, record_type = $2, value = $3, ttl = $4, priority = $5, proxied = $6,
			http_incoming_port = $7, http_outgoing_port = $8, 
			https_incoming_port = $9, https_outgoing_port = $10,
			sync_status = 'pending', updated_at = NOW()
		WHERE id = $11 AND dns_domain_id = $12
	`, req.Name, req.RecordType, req.Value, req.TTL, req.Priority, req.Proxied,
		req.HTTPIncomingPort, req.HTTPOutgoingPort, req.HTTPSIncomingPort, req.HTTPSOutgoingPort,
		recordID, domainID)
	if err != nil {
		log.Printf("Failed to update DNS record: %v", err)
		http.Error(w, "Failed to update record", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Record updated"})
}

// DeleteDNSRecord deletes a DNS record
func (h *DNSHandler) DeleteDNSRecord(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	vars := mux.Vars(r)
	domainID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}
	recordID, err := uuid.Parse(vars["recordId"])
	if err != nil {
		http.Error(w, "Invalid record ID", http.StatusBadRequest)
		return
	}

	// Verify ownership
	var count int
	h.db.Get(&count, "SELECT COUNT(*) FROM dns_managed_domains WHERE id = $1 AND owner_id = $2", domainID, userID)
	if count == 0 {
		http.Error(w, "Domain not found", http.StatusNotFound)
		return
	}

	_, err = h.db.Exec("DELETE FROM dns_records WHERE id = $1 AND dns_domain_id = $2", recordID, domainID)
	if err != nil {
		log.Printf("Failed to delete DNS record: %v", err)
		http.Error(w, "Failed to delete record", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ==================== DNS Sync ====================

// CompareDNSRecords compares local records with remote provider
func (h *DNSHandler) CompareDNSRecords(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	vars := mux.Vars(r)
	domainID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	// Get domain and account
	var domain models.DNSManagedDomain
	err = h.db.Get(&domain, "SELECT * FROM dns_managed_domains WHERE id = $1 AND owner_id = $2", domainID, userID)
	if err != nil {
		http.Error(w, "Domain not found", http.StatusNotFound)
		return
	}

	if domain.DNSAccountID == nil {
		http.Error(w, "No DNS account configured", http.StatusBadRequest)
		return
	}

	var account models.DNSAccount
	err = h.db.Get(&account, "SELECT * FROM dns_accounts WHERE id = $1", domain.DNSAccountID)
	if err != nil {
		http.Error(w, "DNS account not found", http.StatusNotFound)
		return
	}

	// Get local records
	var localDBRecords []models.DNSRecord
	h.db.Select(&localDBRecords, "SELECT * FROM dns_records WHERE dns_domain_id = $1", domainID)

	// Convert to dns.Record
	localRecords := make([]dns.Record, len(localDBRecords))
	for i, r := range localDBRecords {
		priority := 0
		if r.Priority != nil {
			priority = *r.Priority
		}
		localRecords[i] = dns.Record{
			ID:       r.ID.String(),
			Name:     r.Name,
			Type:     r.RecordType,
			Value:    r.Value,
			TTL:      r.TTL,
			Priority: priority,
			Proxied:  r.Proxied,
		}
	}

	// Get remote records
	apiID := ""
	if account.ApiID != nil {
		apiID = *account.ApiID
	}
	provider, _ := dns.NewProvider(account.Provider, apiID, account.ApiToken)

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	remoteRecords, err := provider.ListRecords(ctx, domain.FQDN)
	if err != nil {
		http.Error(w, "Failed to fetch remote records: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Compare
	result := h.syncService.Compare(localRecords, remoteRecords)

	// Update sync status for each local record
	for _, r := range localDBRecords {
		status := "synced"
		for _, conflict := range result.Conflicts {
			if conflict.LocalID == r.ID.String() {
				status = "conflict"
				break
			}
		}
		for _, created := range result.Created {
			if created.ID == r.ID.String() {
				status = "local_only"
				break
			}
		}
		h.db.Exec("UPDATE dns_records SET sync_status = $1 WHERE id = $2", status, r.ID)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// ApplyDNSToRemote pushes local records to remote provider
func (h *DNSHandler) ApplyDNSToRemote(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	vars := mux.Vars(r)
	domainID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	var domain models.DNSManagedDomain
	err = h.db.Get(&domain, "SELECT * FROM dns_managed_domains WHERE id = $1 AND owner_id = $2", domainID, userID)
	if err != nil {
		http.Error(w, "Domain not found", http.StatusNotFound)
		return
	}

	if domain.DNSAccountID == nil {
		http.Error(w, "No DNS account configured", http.StatusBadRequest)
		return
	}

	var account models.DNSAccount
	h.db.Get(&account, "SELECT * FROM dns_accounts WHERE id = $1", domain.DNSAccountID)

	// Get local records
	var localDBRecords []models.DNSRecord
	h.db.Select(&localDBRecords, "SELECT * FROM dns_records WHERE dns_domain_id = $1", domainID)

	localRecords := make([]dns.Record, len(localDBRecords))
	for i, r := range localDBRecords {
		priority := 0
		if r.Priority != nil {
			priority = *r.Priority
		}
		localRecords[i] = dns.Record{
			ID:       r.ID.String(),
			Name:     r.Name,
			Type:     r.RecordType,
			Value:    r.Value,
			TTL:      r.TTL,
			Priority: priority,
			Proxied:  r.Proxied,
		}
	}

	apiID := ""
	if account.ApiID != nil {
		apiID = *account.ApiID
	}
	provider, _ := dns.NewProvider(account.Provider, apiID, account.ApiToken)

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	remoteRecords, _ := provider.ListRecords(ctx, domain.FQDN)

	result, err := h.syncService.ApplyToRemote(ctx, provider, domain.FQDN, localRecords, remoteRecords)
	if err != nil {
		http.Error(w, "Sync failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Update sync status
	now := time.Now()
	for _, r := range localDBRecords {
		h.db.Exec(`
			UPDATE dns_records 
			SET sync_status = 'synced', last_synced_at = $1 
			WHERE id = $2
		`, now, r.ID)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// ImportDNSFromRemote imports records from remote provider to local DB
func (h *DNSHandler) ImportDNSFromRemote(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	vars := mux.Vars(r)
	domainID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	var domain models.DNSManagedDomain
	err = h.db.Get(&domain, "SELECT * FROM dns_managed_domains WHERE id = $1 AND owner_id = $2", domainID, userID)
	if err != nil {
		http.Error(w, "Domain not found", http.StatusNotFound)
		return
	}

	if domain.DNSAccountID == nil {
		http.Error(w, "No DNS account configured", http.StatusBadRequest)
		return
	}

	var account models.DNSAccount
	h.db.Get(&account, "SELECT * FROM dns_accounts WHERE id = $1", domain.DNSAccountID)

	apiID := ""
	if account.ApiID != nil {
		apiID = *account.ApiID
	}
	provider, _ := dns.NewProvider(account.Provider, apiID, account.ApiToken)

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	remoteRecords, err := provider.ListRecords(ctx, domain.FQDN)
	if err != nil {
		http.Error(w, "Failed to fetch remote records: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Delete existing local records
	h.db.Exec("DELETE FROM dns_records WHERE dns_domain_id = $1", domainID)

	// Import remote records
	imported := 0
	now := time.Now()
	for _, r := range remoteRecords {
		var priority *int
		if r.Priority > 0 {
			priority = &r.Priority
		}

		_, err := h.db.Exec(`
			INSERT INTO dns_records (
				dns_domain_id, name, record_type, value, ttl, priority, proxied,
				remote_record_id, sync_status, last_synced_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'synced', $9)
		`, domainID, r.Name, r.Type, r.Value, r.TTL, priority, r.Proxied, r.ID, now)
		if err != nil {
			log.Printf("Failed to import record %s: %v", r.Name, err)
			continue
		}
		imported++
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"imported": imported,
		"message":  "Records imported from provider",
	})
}

// ==================== List Remote Records ====================

// ListRemoteRecords fetches all records directly from the DNS provider
func (h *DNSHandler) ListRemoteRecords(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	vars := mux.Vars(r)
	domainID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	var domain models.DNSManagedDomain
	err = h.db.Get(&domain, "SELECT * FROM dns_managed_domains WHERE id = $1 AND owner_id = $2", domainID, userID)
	if err != nil {
		http.Error(w, "Domain not found", http.StatusNotFound)
		return
	}

	if domain.DNSAccountID == nil {
		http.Error(w, "No DNS account configured for this domain", http.StatusBadRequest)
		return
	}

	var account models.DNSAccount
	err = h.db.Get(&account, "SELECT * FROM dns_accounts WHERE id = $1", *domain.DNSAccountID)
	if err != nil {
		http.Error(w, "DNS account not found", http.StatusNotFound)
		return
	}

	apiID := ""
	if account.ApiID != nil {
		apiID = *account.ApiID
	}
	provider, _ := dns.NewProvider(account.Provider, apiID, account.ApiToken)

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	remoteRecords, err := provider.ListRecords(ctx, domain.FQDN)
	if err != nil {
		http.Error(w, "Failed to fetch records from provider: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"domain":   domain.FQDN,
		"provider": account.Provider,
		"records":  remoteRecords,
	})
}

// ==================== DNS Lookup (Debug) ====================

type DNSLookupResult struct {
	Type    string   `json:"type"`
	Records []string `json:"records"`
	Error   string   `json:"error,omitempty"`
}

// LookupDNS performs a public DNS lookup for debugging
func (h *DNSHandler) LookupDNS(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	vars := mux.Vars(r)
	domainID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	// Get domain FQDN
	var fqdn string
	err = h.db.Get(&fqdn, "SELECT fqdn FROM dns_managed_domains WHERE id = $1 AND owner_id = $2", domainID, userID)
	if err != nil {
		http.Error(w, "Domain not found", http.StatusNotFound)
		return
	}

	// Optional subdomain query param
	subdomain := r.URL.Query().Get("subdomain")
	lookupName := fqdn
	if subdomain != "" && subdomain != "@" {
		lookupName = subdomain + "." + fqdn
	}

	results := make(map[string]DNSLookupResult)

	// A records
	aRecords, err := net.LookupHost(lookupName)
	if err != nil {
		results["A"] = DNSLookupResult{Type: "A", Records: []string{}, Error: err.Error()}
	} else {
		// Filter to only IPv4
		var ipv4s []string
		for _, ip := range aRecords {
			if !strings.Contains(ip, ":") {
				ipv4s = append(ipv4s, ip)
			}
		}
		results["A"] = DNSLookupResult{Type: "A", Records: ipv4s}
	}

	// AAAA records
	var ipv6s []string
	for _, ip := range aRecords {
		if strings.Contains(ip, ":") {
			ipv6s = append(ipv6s, ip)
		}
	}
	if len(ipv6s) > 0 {
		results["AAAA"] = DNSLookupResult{Type: "AAAA", Records: ipv6s}
	} else {
		results["AAAA"] = DNSLookupResult{Type: "AAAA", Records: []string{}}
	}

	// CNAME record
	cname, err := net.LookupCNAME(lookupName)
	if err != nil {
		results["CNAME"] = DNSLookupResult{Type: "CNAME", Records: []string{}, Error: err.Error()}
	} else {
		cname = strings.TrimSuffix(cname, ".")
		if cname != lookupName {
			results["CNAME"] = DNSLookupResult{Type: "CNAME", Records: []string{cname}}
		} else {
			results["CNAME"] = DNSLookupResult{Type: "CNAME", Records: []string{}}
		}
	}

	// MX records
	mxRecords, err := net.LookupMX(lookupName)
	if err != nil {
		results["MX"] = DNSLookupResult{Type: "MX", Records: []string{}, Error: err.Error()}
	} else {
		var mxStrs []string
		for _, mx := range mxRecords {
			mxStrs = append(mxStrs, fmt.Sprintf("%d %s", mx.Pref, strings.TrimSuffix(mx.Host, ".")))
		}
		results["MX"] = DNSLookupResult{Type: "MX", Records: mxStrs}
	}

	// TXT records
	txtRecords, err := net.LookupTXT(lookupName)
	if err != nil {
		results["TXT"] = DNSLookupResult{Type: "TXT", Records: []string{}, Error: err.Error()}
	} else {
		results["TXT"] = DNSLookupResult{Type: "TXT", Records: txtRecords}
	}

	// NS records (only for root domain)
	if subdomain == "" || subdomain == "@" {
		nsRecords, err := net.LookupNS(fqdn)
		if err != nil {
			results["NS"] = DNSLookupResult{Type: "NS", Records: []string{}, Error: err.Error()}
		} else {
			var nsStrs []string
			for _, ns := range nsRecords {
				nsStrs = append(nsStrs, strings.TrimSuffix(ns.Host, "."))
			}
			results["NS"] = DNSLookupResult{Type: "NS", Records: nsStrs}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"domain":    fqdn,
		"subdomain": subdomain,
		"lookup":    lookupName,
		"results":   results,
	})
}
