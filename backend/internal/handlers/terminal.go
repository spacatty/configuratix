package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/database"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for WebSocket
	},
}

type TerminalHandler struct {
	db *database.DB
	// Active terminal sessions: machineID -> session
	sessions     map[uuid.UUID]*TerminalSession
	sessionsLock sync.RWMutex
}

// connWithLock wraps a websocket connection with its own write mutex
type connWithLock struct {
	conn      *websocket.Conn
	writeLock sync.Mutex
}

type TerminalSession struct {
	MachineID uuid.UUID
	AgentID   uuid.UUID

	// Agent WebSocket connection
	agentConn     *websocket.Conn
	agentConnLock sync.Mutex

	// User WebSocket connections (use connWithLock for safe concurrent writes)
	userConns     []*connWithLock
	userConnsLock sync.Mutex
}

type TerminalMessage struct {
	Type string `json:"type"` // input, output, resize, ping, pong, status
	Data string `json:"data,omitempty"`
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
}

func NewTerminalHandler(db *database.DB) *TerminalHandler {
	return &TerminalHandler{
		db:       db,
		sessions: make(map[uuid.UUID]*TerminalSession),
	}
}

// UserTerminalConnect handles WebSocket connection from user browser
func (h *TerminalHandler) UserTerminalConnect(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	// Check user has access to this machine
	var ownerID *uuid.UUID
	var projectID *uuid.UUID
	err = h.db.QueryRow(`
		SELECT owner_id, project_id FROM machines WHERE id = $1
	`, machineID).Scan(&ownerID, &projectID)
	if err != nil {
		http.Error(w, "Machine not found", http.StatusNotFound)
		return
	}

	// Check access
	hasAccess := false
	if claims.IsSuperAdmin() {
		hasAccess = true
	} else if ownerID != nil && *ownerID == userID {
		hasAccess = true
	} else if projectID != nil {
		var count int
		h.db.Get(&count, `
			SELECT COUNT(*) FROM project_members 
			WHERE project_id = $1 AND user_id = $2 AND status = 'approved' AND role = 'manager'
		`, projectID, userID)
		hasAccess = count > 0
	}

	if !hasAccess {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	// Upgrade to WebSocket
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Failed to upgrade WebSocket: %v", err)
		return
	}
	defer conn.Close()

	// Get or create session
	h.sessionsLock.Lock()
	session, exists := h.sessions[machineID]
	if !exists {
		session = &TerminalSession{
			MachineID: machineID,
		}
		h.sessions[machineID] = session
	}
	h.sessionsLock.Unlock()

	// Configure WebSocket ping/pong handlers
	conn.SetPongHandler(func(appData string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	// Add this connection to session with its own write lock
	userConn := &connWithLock{conn: conn}
	session.userConnsLock.Lock()
	session.userConns = append(session.userConns, userConn)
	session.userConnsLock.Unlock()

	defer func() {
		session.userConnsLock.Lock()
		for i, c := range session.userConns {
			if c.conn == conn {
				session.userConns = append(session.userConns[:i], session.userConns[i+1:]...)
				break
			}
		}
		session.userConnsLock.Unlock()
	}()

	// Check if agent is connected
	session.agentConnLock.Lock()
	agentConnected := session.agentConn != nil
	session.agentConnLock.Unlock()

	// Send initial status message
	userConn.writeLock.Lock()
	if agentConnected {
		conn.WriteJSON(TerminalMessage{
			Type: "output",
			Data: "\r\n\x1b[32mConnected to terminal session.\x1b[0m\r\n",
		})
	} else {
		conn.WriteJSON(TerminalMessage{
			Type: "output",
			Data: "\r\n\x1b[32mConnected to terminal session.\x1b[0m\r\n\x1b[33mWaiting for agent connection...\x1b[0m\r\n",
		})
	}
	userConn.writeLock.Unlock()

	// Set initial read deadline
	conn.SetReadDeadline(time.Now().Add(60 * time.Second))

	// Keepalive ping goroutine - use WebSocket ping control frame
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				userConn.writeLock.Lock()
				conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
				err := conn.WriteMessage(websocket.PingMessage, []byte("keepalive"))
				userConn.writeLock.Unlock()
				if err != nil {
					return
				}
			}
		}
	}()
	defer close(done)

	// Handle incoming messages from user - relay to agent
	for {
		var msg TerminalMessage
		if err := conn.ReadJSON(&msg); err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				return
			}
			log.Printf("Terminal read error: %v", err)
			return
		}

		// Extend read deadline on any message
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))

		switch msg.Type {
		case "input", "resize":
			// Relay to agent
			session.agentConnLock.Lock()
			if session.agentConn != nil {
				session.agentConn.SetWriteDeadline(time.Now().Add(5 * time.Second))
				session.agentConn.WriteJSON(msg)
			}
			session.agentConnLock.Unlock()
		case "ping":
			userConn.writeLock.Lock()
			conn.WriteJSON(TerminalMessage{Type: "pong"})
			userConn.writeLock.Unlock()
		case "pong":
			// Keepalive response, ignore
		}
	}
}

// AgentTerminalConnect handles WebSocket connection from agent for terminal
func (h *TerminalHandler) AgentTerminalConnect(w http.ResponseWriter, r *http.Request) {
	agentID, ok := r.Context().Value("agent_id").(uuid.UUID)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Find machine for this agent
	var machineID uuid.UUID
	err := h.db.Get(&machineID, "SELECT id FROM machines WHERE agent_id = $1", agentID)
	if err != nil {
		http.Error(w, "Machine not found", http.StatusNotFound)
		return
	}

	// Upgrade to WebSocket
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Failed to upgrade agent WebSocket: %v", err)
		return
	}
	defer conn.Close()

	log.Printf("Agent terminal connected for machine %s", machineID)

	// Configure WebSocket ping/pong handlers
	conn.SetPongHandler(func(appData string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	// Get or create session
	h.sessionsLock.Lock()
	session, exists := h.sessions[machineID]
	if !exists {
		session = &TerminalSession{
			MachineID: machineID,
			AgentID:   agentID,
		}
		h.sessions[machineID] = session
	}
	session.AgentID = agentID
	h.sessionsLock.Unlock()

	// Set agent connection
	session.agentConnLock.Lock()
	oldConn := session.agentConn
	session.agentConn = conn
	session.agentConnLock.Unlock()

	// Close old connection if exists
	if oldConn != nil {
		oldConn.Close()
	}

	defer func() {
		session.agentConnLock.Lock()
		if session.agentConn == conn {
			session.agentConn = nil
		}
		session.agentConnLock.Unlock()
		log.Printf("Agent terminal disconnected for machine %s", machineID)
	}()

	// Notify users that agent connected
	h.broadcastToUsers(session, TerminalMessage{
		Type: "output",
		Data: "\r\n\x1b[32mAgent connected. Terminal ready.\x1b[0m\r\n",
	})

	// Set initial read deadline
	conn.SetReadDeadline(time.Now().Add(60 * time.Second))

	// Keepalive ping goroutine for agent using WebSocket ping control frame
	agentDone := make(chan struct{})
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-agentDone:
				return
			case <-ticker.C:
				session.agentConnLock.Lock()
				if session.agentConn != nil {
					session.agentConn.SetWriteDeadline(time.Now().Add(5 * time.Second))
					// Use WebSocket ping control frame instead of JSON
					err := session.agentConn.WriteMessage(websocket.PingMessage, []byte("keepalive"))
					session.agentConnLock.Unlock()
					if err != nil {
						return
					}
				} else {
					session.agentConnLock.Unlock()
					return
				}
			}
		}
	}()
	defer close(agentDone)

	// Read from agent WebSocket and relay to users
	for {
		var msg TerminalMessage
		if err := conn.ReadJSON(&msg); err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				break
			}
			log.Printf("Agent terminal read error: %v", err)
			break
		}

		// Extend read deadline on any message
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))

		switch msg.Type {
		case "output":
			// Relay output to all users
			h.broadcastToUsers(session, msg)
		case "ping":
			// Respond to JSON ping (fallback)
			session.agentConnLock.Lock()
			if session.agentConn != nil {
				session.agentConn.WriteJSON(TerminalMessage{Type: "pong"})
			}
			session.agentConnLock.Unlock()
		case "pong":
			// Keepalive response, extend deadline
		}
	}

	// Notify users that agent disconnected
	h.broadcastToUsers(session, TerminalMessage{
		Type: "output",
		Data: "\r\n\x1b[31mAgent disconnected.\x1b[0m\r\n",
	})
}

func (h *TerminalHandler) broadcastToUsers(session *TerminalSession, msg TerminalMessage) {
	session.userConnsLock.Lock()
	defer session.userConnsLock.Unlock()

	data, _ := json.Marshal(msg)
	for _, userConn := range session.userConns {
		userConn.writeLock.Lock()
		userConn.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if err := userConn.conn.WriteMessage(websocket.TextMessage, data); err != nil {
			log.Printf("Failed to write to user conn: %v", err)
		}
		userConn.writeLock.Unlock()
	}
}

// GetTerminalStatus returns current terminal session status for a machine
func (h *TerminalHandler) GetTerminalStatus(w http.ResponseWriter, r *http.Request) {
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	h.sessionsLock.RLock()
	session, exists := h.sessions[machineID]
	h.sessionsLock.RUnlock()

	status := map[string]interface{}{
		"has_session":     exists,
		"agent_connected": false,
		"users_connected": 0,
	}

	if exists {
		session.agentConnLock.Lock()
		status["agent_connected"] = session.agentConn != nil
		session.agentConnLock.Unlock()
		
		session.userConnsLock.Lock()
		status["users_connected"] = len(session.userConns)
		session.userConnsLock.Unlock()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}
