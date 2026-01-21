package audit

import (
	"log"
	"time"
)

// EventType represents the type of audit event
type EventType string

const (
	EventLogin               EventType = "login"
	EventLoginFailed         EventType = "login_failed"
	EventPasswordChange      EventType = "password_change"
	EventAdminPasswordChange EventType = "admin_password_change"
	EventRoleChange          EventType = "role_change"
	Event2FAEnabled          EventType = "2fa_enabled"
	Event2FADisabled         EventType = "2fa_disabled"
	Event2FAReset            EventType = "2fa_reset"
	EventUserCreated         EventType = "user_created"
	EventUserDeleted         EventType = "user_deleted"
	EventMachineTokenReset   EventType = "machine_token_reset"
	EventMachineDeleted      EventType = "machine_deleted"
	EventProjectCreated      EventType = "project_created"
	EventProjectDeleted      EventType = "project_deleted"
)

// Log records an audit event
// In production, this should write to a database or external audit service
func Log(eventType EventType, userID, targetID string, details map[string]interface{}) {
	timestamp := time.Now().UTC().Format(time.RFC3339)
	
	// For now, log to stdout. In production, store in DB or send to audit service
	log.Printf("AUDIT [%s] event=%s user=%s target=%s details=%v",
		timestamp, eventType, userID, targetID, details)
}

// LogWithIP records an audit event with IP address
func LogWithIP(eventType EventType, userID, targetID, ip string, details map[string]interface{}) {
	if details == nil {
		details = make(map[string]interface{})
	}
	details["ip"] = ip
	Log(eventType, userID, targetID, details)
}

