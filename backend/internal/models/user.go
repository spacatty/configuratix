package models

import (
	"time"

	"github.com/google/uuid"
)

// User roles
const (
	RoleSuperAdmin = "superadmin"
	RoleAdmin      = "admin"
	RoleUser       = "user"
)

type User struct {
	ID                uuid.UUID  `db:"id" json:"id"`
	Email             string     `db:"email" json:"email"`
	Name              *string    `db:"name" json:"name"`
	PasswordHash      string     `db:"password_hash" json:"-"`
	Role              string     `db:"role" json:"role"`
	TOTPSecret        *string    `db:"totp_secret" json:"-"`
	TOTPEnabled       bool       `db:"totp_enabled" json:"totp_enabled"`
	PasswordChangedAt *time.Time `db:"password_changed_at" json:"password_changed_at"`
	CreatedAt         time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt         time.Time  `db:"updated_at" json:"updated_at"`
}

// IsSuperAdmin checks if user is superadmin
func (u *User) IsSuperAdmin() bool {
	return u.Role == RoleSuperAdmin
}

// IsAdmin checks if user is admin or superadmin
func (u *User) IsAdmin() bool {
	return u.Role == RoleAdmin || u.Role == RoleSuperAdmin
}

// CanCreateAdmin checks if user can create admin users
func (u *User) CanCreateAdmin() bool {
	return u.Role == RoleSuperAdmin
}

// CanResetUserToken checks if user can reset another user's machine token
func (u *User) CanResetUserToken() bool {
	return u.Role == RoleSuperAdmin
}

// CanResetUser2FA checks if user can reset another user's 2FA
func (u *User) CanResetUser2FA() bool {
	return u.Role == RoleAdmin || u.Role == RoleSuperAdmin
}

// CanChangeUserPassword checks if user can change another user's password
func (u *User) CanChangeUserPassword() bool {
	return u.Role == RoleAdmin || u.Role == RoleSuperAdmin
}

// CanViewAllData checks if user can view all projects/machines (admin area)
func (u *User) CanViewAllData() bool {
	return u.Role == RoleSuperAdmin
}
