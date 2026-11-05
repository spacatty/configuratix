package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/database"
	"configuratix/backend/internal/templates"

	"github.com/google/uuid"
)

// machineVisibilitySQL returns a boolean SQL expression that restricts machines aliased as
// `alias` to the ones visible to the user bound at placeholder $n. Mirrors ListMachines:
// own machines plus machines of projects the user owns or is an approved member of.
func machineVisibilitySQL(alias string, n int) string {
	return fmt.Sprintf(`(%[1]s.owner_id = $%[2]d OR %[1]s.project_id IN (
		SELECT id FROM projects WHERE owner_id = $%[2]d
		UNION
		SELECT project_id FROM project_members WHERE user_id = $%[2]d AND status = 'approved'))`, alias, n)
}

// requestClaims returns the authenticated claims and user id.
func requestClaims(r *http.Request) (*auth.Claims, uuid.UUID, bool) {
	claims, ok := r.Context().Value("claims").(*auth.Claims)
	if !ok || claims == nil {
		return nil, uuid.Nil, false
	}
	uid, _ := uuid.Parse(claims.UserID)
	return claims, uid, true
}

// canAccessMachineID reports whether the requester may view the machine.
func canAccessMachineID(db *database.DB, r *http.Request, machineID uuid.UUID) bool {
	claims, uid, ok := requestClaims(r)
	if !ok {
		return false
	}
	return (&MachinesHandler{db: db}).canAccessMachine(uid, machineID, claims.IsSuperAdmin())
}

// canManageMachineID reports whether the requester may change the machine (run jobs on it).
func canManageMachineID(db *database.DB, r *http.Request, machineID uuid.UUID) bool {
	claims, uid, ok := requestClaims(r)
	if !ok {
		return false
	}
	return (&MachinesHandler{db: db}).canManageMachine(uid, machineID, claims.IsSuperAdmin())
}

// machineAgentID returns the agent id of a machine (error when no agent is connected).
func machineAgentID(db *database.DB, machineID uuid.UUID) (uuid.UUID, error) {
	var agentID uuid.UUID
	err := db.Get(&agentID, "SELECT agent_id FROM machines WHERE id = $1 AND agent_id IS NOT NULL", machineID)
	return agentID, err
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if status != 0 && status != http.StatusOK {
		w.WriteHeader(status)
	}
	_ = json.NewEncoder(w).Encode(v)
}

// errorStatus maps validation errors (templates.ValidationError) to 400, everything else to 500.
func errorStatus(err error) int {
	var ve *templates.ValidationError
	if errors.As(err, &ve) {
		return http.StatusBadRequest
	}
	return http.StatusInternalServerError
}
