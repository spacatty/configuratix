package handlers

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image/png"
	"log"
	"net/http"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/database"
	"configuratix/backend/internal/models"

	"github.com/google/uuid"
	"github.com/pquerna/otp/totp"
)

type AuthHandler struct {
	db *database.DB
}

func NewAuthHandler(db *database.DB) *AuthHandler {
	return &AuthHandler{db: db}
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	TOTPCode string `json:"totp_code,omitempty"`
}

type LoginResponse struct {
	Token       string      `json:"token,omitempty"`
	User        models.User `json:"user"`
	Requires2FA bool        `json:"requires_2fa,omitempty"`
}

type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	var user models.User
	err := h.db.Get(&user, `
		SELECT id, email, name, password_hash, role, totp_secret, totp_enabled, 
		       password_changed_at, created_at, updated_at 
		FROM users WHERE email = $1
	`, req.Email)
	if err != nil {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	if !auth.CheckPassword(req.Password, user.PasswordHash) {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	// Check if 2FA is enabled
	if user.TOTPEnabled && user.TOTPSecret != nil {
		// If no TOTP code provided, ask for it
		if req.TOTPCode == "" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(LoginResponse{
				Requires2FA: true,
				User:        models.User{ID: user.ID, Email: user.Email},
			})
			return
		}

		// Validate TOTP code
		if !totp.Validate(req.TOTPCode, *user.TOTPSecret) {
			http.Error(w, "Invalid 2FA code", http.StatusUnauthorized)
			return
		}
	}

	token, err := auth.GenerateToken(user.ID.String(), user.Email, user.Role)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	user.PasswordHash = ""
	user.TOTPSecret = nil
	response := LoginResponse{
		Token: token,
		User:  user,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// Register handles user registration
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if req.Email == "" || req.Password == "" {
		http.Error(w, "Email and password are required", http.StatusBadRequest)
		return
	}

	if len(req.Password) < 8 {
		http.Error(w, "Password must be at least 8 characters", http.StatusBadRequest)
		return
	}

	// Check if email already exists
	var count int
	h.db.Get(&count, "SELECT COUNT(*) FROM users WHERE email = $1", req.Email)
	if count > 0 {
		http.Error(w, "Email already registered", http.StatusConflict)
		return
	}

	// Hash password
	passwordHash, err := auth.HashPassword(req.Password)
	if err != nil {
		log.Printf("Failed to hash password: %v", err)
		http.Error(w, "Failed to create account", http.StatusInternalServerError)
		return
	}

	// Create user with default 'user' role
	var user models.User
	err = h.db.Get(&user, `
		INSERT INTO users (email, name, password_hash, role)
		VALUES ($1, $2, $3, 'user')
		RETURNING id, email, name, role, totp_enabled, created_at, updated_at
	`, req.Email, req.Name, passwordHash)
	if err != nil {
		log.Printf("Failed to create user: %v", err)
		http.Error(w, "Failed to create account", http.StatusInternalServerError)
		return
	}

	// Generate token
	token, err := auth.GenerateToken(user.ID.String(), user.Email, user.Role)
	if err != nil {
		http.Error(w, "Account created but failed to generate token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(LoginResponse{
		Token: token,
		User:  user,
	})
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value("claims").(*auth.Claims)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	userID, err := uuid.Parse(claims.UserID)
	if err != nil {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	var user models.User
	err = h.db.Get(&user, `
		SELECT id, email, name, role, totp_enabled, password_changed_at, created_at, updated_at 
		FROM users WHERE id = $1
	`, userID)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	user.PasswordHash = ""
	user.TOTPSecret = nil
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

// ChangePassword handles password change for current user
func (h *AuthHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value("claims").(*auth.Claims)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if len(req.NewPassword) < 8 {
		http.Error(w, "Password must be at least 8 characters", http.StatusBadRequest)
		return
	}

	userID, _ := uuid.Parse(claims.UserID)

	// Get current password hash
	var currentHash string
	err := h.db.Get(&currentHash, "SELECT password_hash FROM users WHERE id = $1", userID)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	// Verify current password
	if !auth.CheckPassword(req.CurrentPassword, currentHash) {
		http.Error(w, "Current password is incorrect", http.StatusUnauthorized)
		return
	}

	// Hash new password
	newHash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		http.Error(w, "Failed to update password", http.StatusInternalServerError)
		return
	}

	// Update password
	_, err = h.db.Exec(`
		UPDATE users SET password_hash = $1, password_changed_at = NOW(), updated_at = NOW()
		WHERE id = $2
	`, newHash, userID)
	if err != nil {
		http.Error(w, "Failed to update password", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Password updated successfully"})
}

// Setup2FA generates a new TOTP secret and QR code
func (h *AuthHandler) Setup2FA(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value("claims").(*auth.Claims)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	userID, _ := uuid.Parse(claims.UserID)

	// Generate new TOTP key
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "Configuratix",
		AccountName: claims.Email,
	})
	if err != nil {
		log.Printf("Failed to generate TOTP key: %v", err)
		http.Error(w, "Failed to setup 2FA", http.StatusInternalServerError)
		return
	}

	// Generate QR code
	var buf bytes.Buffer
	img, err := key.Image(200, 200)
	if err != nil {
		http.Error(w, "Failed to generate QR code", http.StatusInternalServerError)
		return
	}
	png.Encode(&buf, img)
	qrCode := base64.StdEncoding.EncodeToString(buf.Bytes())

	// Store secret temporarily (not enabled yet)
	_, err = h.db.Exec(`
		UPDATE users SET totp_secret = $1, updated_at = NOW()
		WHERE id = $2
	`, key.Secret(), userID)
	if err != nil {
		http.Error(w, "Failed to setup 2FA", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"secret":  key.Secret(),
		"qr_code": "data:image/png;base64," + qrCode,
		"url":     key.URL(),
	})
}

// Enable2FA verifies a TOTP code and enables 2FA
func (h *AuthHandler) Enable2FA(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value("claims").(*auth.Claims)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	userID, _ := uuid.Parse(claims.UserID)

	// Get stored secret
	var secret string
	err := h.db.Get(&secret, "SELECT totp_secret FROM users WHERE id = $1", userID)
	if err != nil || secret == "" {
		http.Error(w, "2FA not set up", http.StatusBadRequest)
		return
	}

	// Validate code
	if !totp.Validate(req.Code, secret) {
		http.Error(w, "Invalid verification code", http.StatusBadRequest)
		return
	}

	// Enable 2FA
	_, err = h.db.Exec(`
		UPDATE users SET totp_enabled = true, updated_at = NOW()
		WHERE id = $1
	`, userID)
	if err != nil {
		http.Error(w, "Failed to enable 2FA", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "2FA enabled successfully"})
}

// Disable2FA disables 2FA for the current user
func (h *AuthHandler) Disable2FA(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value("claims").(*auth.Claims)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	userID, _ := uuid.Parse(claims.UserID)

	// Verify password
	var currentHash string
	err := h.db.Get(&currentHash, "SELECT password_hash FROM users WHERE id = $1", userID)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	if !auth.CheckPassword(req.Password, currentHash) {
		http.Error(w, "Invalid password", http.StatusUnauthorized)
		return
	}

	// Disable 2FA
	_, err = h.db.Exec(`
		UPDATE users SET totp_enabled = false, totp_secret = NULL, updated_at = NOW()
		WHERE id = $1
	`, userID)
	if err != nil {
		http.Error(w, "Failed to disable 2FA", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "2FA disabled successfully"})
}

// UpdateProfile updates the current user's profile
func (h *AuthHandler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value("claims").(*auth.Claims)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	userID, _ := uuid.Parse(claims.UserID)

	_, err := h.db.Exec(`
		UPDATE users SET name = $1, updated_at = NOW()
		WHERE id = $2
	`, req.Name, userID)
	if err != nil {
		http.Error(w, "Failed to update profile", http.StatusInternalServerError)
		return
	}

	// Return updated user
	var user models.User
	h.db.Get(&user, `
		SELECT id, email, name, role, totp_enabled, password_changed_at, created_at, updated_at 
		FROM users WHERE id = $1
	`, userID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}
