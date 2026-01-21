package models

import (
	"time"

	"github.com/google/uuid"
)

// Project member roles
const (
	ProjectRoleMember  = "member"
	ProjectRoleManager = "manager"
)

// Project member status
const (
	MemberStatusPending  = "pending"
	MemberStatusApproved = "approved"
	MemberStatusDenied   = "denied"
)

type Project struct {
	ID              uuid.UUID  `db:"id" json:"id"`
	Name            string     `db:"name" json:"name"`
	OwnerID         uuid.UUID  `db:"owner_id" json:"owner_id"`
	NotesMD         string     `db:"notes_md" json:"notes_md"`
	SharingEnabled  bool       `db:"sharing_enabled" json:"sharing_enabled"`
	InviteToken     *string    `db:"invite_token" json:"invite_token,omitempty"`
	InviteExpiresAt *time.Time `db:"invite_expires_at" json:"invite_expires_at,omitempty"`
	CreatedAt       time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt       time.Time  `db:"updated_at" json:"updated_at"`
}

type ProjectMember struct {
	ID           uuid.UUID `db:"id" json:"id"`
	ProjectID    uuid.UUID `db:"project_id" json:"project_id"`
	UserID       uuid.UUID `db:"user_id" json:"user_id"`
	Role         string    `db:"role" json:"role"` // member, manager
	CanViewNotes bool      `db:"can_view_notes" json:"can_view_notes"`
	Status       string    `db:"status" json:"status"` // pending, approved, denied
	CreatedAt    time.Time `db:"created_at" json:"created_at"`
	UpdatedAt    time.Time `db:"updated_at" json:"updated_at"`
}

// ProjectWithStats includes computed stats
// Note: Explicitly list all fields instead of embedding to avoid sqlx scanning issues
type ProjectWithStats struct {
	// Project fields
	ID              uuid.UUID  `db:"id" json:"id"`
	Name            string     `db:"name" json:"name"`
	OwnerID         uuid.UUID  `db:"owner_id" json:"owner_id"`
	NotesMD         string     `db:"notes_md" json:"notes_md"`
	SharingEnabled  bool       `db:"sharing_enabled" json:"sharing_enabled"`
	InviteToken     *string    `db:"invite_token" json:"invite_token,omitempty"`
	InviteExpiresAt *time.Time `db:"invite_expires_at" json:"invite_expires_at,omitempty"`
	CreatedAt       time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt       time.Time  `db:"updated_at" json:"updated_at"`
	// Stats fields
	OwnerEmail      string `db:"owner_email" json:"owner_email"`
	OwnerName       string `db:"owner_name" json:"owner_name"`
	MachineCount    int    `db:"machine_count" json:"machine_count"`
	MemberCount     int    `db:"member_count" json:"member_count"`
	OnlineMachines  int    `db:"online_machines" json:"online_machines"`
	OfflineMachines int    `db:"offline_machines" json:"offline_machines"`
}

// ProjectMemberWithUser includes user info
// Note: Explicitly list all fields instead of embedding to avoid sqlx scanning issues
type ProjectMemberWithUser struct {
	// ProjectMember fields
	ID           uuid.UUID `db:"id" json:"id"`
	ProjectID    uuid.UUID `db:"project_id" json:"project_id"`
	UserID       uuid.UUID `db:"user_id" json:"user_id"`
	Role         string    `db:"role" json:"role"`
	CanViewNotes bool      `db:"can_view_notes" json:"can_view_notes"`
	Status       string    `db:"status" json:"status"`
	CreatedAt    time.Time `db:"created_at" json:"created_at"`
	UpdatedAt    time.Time `db:"updated_at" json:"updated_at"`
	// User fields
	UserEmail string `db:"user_email" json:"user_email"`
	UserName  string `db:"user_name" json:"user_name"`
}

// IsManager checks if member has manager role
func (m *ProjectMember) IsManager() bool {
	return m.Role == ProjectRoleManager
}

// CanEdit checks if member can edit project data
func (m *ProjectMember) CanEdit() bool {
	return m.Role == ProjectRoleManager && m.Status == MemberStatusApproved
}

// CanRead checks if member can read project data
func (m *ProjectMember) CanRead() bool {
	return m.Status == MemberStatusApproved
}

