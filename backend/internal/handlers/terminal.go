package handlers

import (
	"encoding/json"
	"errors"
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

// Keepalive discipline, identical on all four legs (browser<->backend and
// backend<->agent, both directions): a control-frame ping every
// terminalPingInterval, read deadline terminalReadTimeout refreshed on pong,
// ping and any message; every write gets a fresh deadline and any write
// error closes the connection (gorilla write errors are permanent).
const (
	terminalPingInterval = 20 * time.Second
	terminalReadTimeout  = 70 * time.Second
	terminalWriteTimeout = 10 * time.Second
	// How long users see "agent reconnecting" before "agent disconnected".
	agentReconnectGrace = 30 * time.Second
)

// Status codes sent to browsers as {"type":"status","data":<code>}.
const (
	termStatusAgentConnected    = "agent_connected"
	termStatusAgentWaiting      = "agent_waiting"
	termStatusAgentReconnecting = "agent_reconnecting"
	termStatusAgentDisconnected = "agent_disconnected"
)

type TerminalMessage struct {
	Type      string `json:"type"` // input, output, resize, ping, pong, status
	Data      string `json:"data,omitempty"`
	Cols      int    `json:"cols,omitempty"`
	Rows      int    `json:"rows,omitempty"`
	SessionID string `json:"session_id,omitempty"` // agent PTY session id (persists across reconnects)
}

// wsConn wraps a websocket with a write mutex (gorilla supports one
// concurrent writer) and closes the socket on the first write error.
type wsConn struct {
	conn      *websocket.Conn
	mu        sync.Mutex
	closed    bool
	closeOnce sync.Once
}

func newWSConn(c *websocket.Conn) *wsConn { return &wsConn{conn: c} }

var errConnClosed = errors.New("connection closed")

func (c *wsConn) writeRaw(data []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return errConnClosed
	}
	c.conn.SetWriteDeadline(time.Now().Add(terminalWriteTimeout))
	if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
		c.closed = true
		c.conn.Close()
		return err
	}
	return nil
}

func (c *wsConn) writeJSON(v interface{}) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return c.writeRaw(data)
}

func (c *wsConn) ping() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return errConnClosed
	}
	if err := c.conn.WriteControl(websocket.PingMessage, []byte("keepalive"), time.Now().Add(terminalWriteTimeout)); err != nil {
		c.closed = true
		c.conn.Close()
		return err
	}
	return nil
}

func (c *wsConn) close() {
	c.closeOnce.Do(func() {
		c.mu.Lock()
		c.closed = true
		c.mu.Unlock()
		c.conn.Close()
	})
}

// prepareRead installs deadline-refreshing ping/pong handlers.
func (c *wsConn) prepareRead() {
	conn := c.conn
	conn.SetReadLimit(1 << 20)
	conn.SetReadDeadline(time.Now().Add(terminalReadTimeout))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(terminalReadTimeout))
		return nil
	})
	conn.SetPingHandler(func(appData string) error {
		conn.SetReadDeadline(time.Now().Add(terminalReadTimeout))
		if err := conn.WriteControl(websocket.PongMessage, []byte(appData), time.Now().Add(terminalWriteTimeout)); err != nil && !errors.Is(err, websocket.ErrCloseSent) {
			c.close()
		}
		return nil
	})
}

// keepalive pings until stop is closed or a ping fails.
func (c *wsConn) keepalive(stop <-chan struct{}) {
	t := time.NewTicker(terminalPingInterval)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.C:
			if err := c.ping(); err != nil {
				return
			}
		}
	}
}

type TerminalHandler struct {
	db *database.DB
	// Active terminal sessions: machineID -> session
	sessions     map[uuid.UUID]*TerminalSession
	sessionsLock sync.Mutex
}

// TerminalSession links one agent connection with any number of browser
// connections for a machine. Lock order: handler.sessionsLock -> session.mu.
type TerminalSession struct {
	MachineID uuid.UUID
	AgentID   uuid.UUID

	mu             sync.Mutex
	agent          *wsConn
	users          map[*wsConn]struct{}
	agentSessionID string
	reconnectTimer *time.Timer
}

func NewTerminalHandler(db *database.DB) *TerminalHandler {
	return &TerminalHandler{
		db:       db,
		sessions: make(map[uuid.UUID]*TerminalSession),
	}
}

func (h *TerminalHandler) getSession(machineID uuid.UUID) *TerminalSession {
	h.sessionsLock.Lock()
	defer h.sessionsLock.Unlock()
	s, ok := h.sessions[machineID]
	if !ok {
		s = &TerminalSession{MachineID: machineID, users: map[*wsConn]struct{}{}}
		h.sessions[machineID] = s
	}
	return s
}

// cleanupSession drops the session when neither agent nor users remain.
func (h *TerminalHandler) cleanupSession(s *TerminalSession) {
	h.sessionsLock.Lock()
	defer h.sessionsLock.Unlock()
	s.mu.Lock()
	empty := s.agent == nil && len(s.users) == 0
	if empty && s.reconnectTimer != nil {
		s.reconnectTimer.Stop()
		s.reconnectTimer = nil
	}
	s.mu.Unlock()
	if empty && h.sessions[s.MachineID] == s {
		delete(h.sessions, s.MachineID)
	}
}

func (s *TerminalSession) removeUser(c *wsConn) {
	s.mu.Lock()
	delete(s.users, c)
	s.mu.Unlock()
	c.close()
}

func (s *TerminalSession) agentConn() *wsConn {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.agent
}

// broadcast writes msg to every user; users whose write fails are dropped.
func (h *TerminalHandler) broadcast(s *TerminalSession, msg TerminalMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	s.mu.Lock()
	users := make([]*wsConn, 0, len(s.users))
	for u := range s.users {
		users = append(users, u)
	}
	s.mu.Unlock()
	dropped := false
	for _, u := range users {
		if err := u.writeRaw(data); err != nil {
			s.removeUser(u)
			dropped = true
		}
	}
	if dropped {
		h.cleanupSession(s)
	}
}

func statusMsg(code, sessionID string) TerminalMessage {
	return TerminalMessage{Type: "status", Data: code, SessionID: sessionID}
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

	// Upgrade to WebSocket (never log r.URL: it carries the auth token)
	raw, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Failed to upgrade terminal WebSocket for machine %s: %v", machineID, err)
		return
	}
	uc := newWSConn(raw)

	session := h.getSession(machineID)
	session.mu.Lock()
	session.users[uc] = struct{}{}
	agentConnected := session.agent != nil
	agentSessionID := session.agentSessionID
	reconnecting := !agentConnected && session.reconnectTimer != nil
	session.mu.Unlock()

	defer func() {
		session.removeUser(uc)
		h.cleanupSession(session)
	}()

	switch {
	case agentConnected:
		uc.writeJSON(statusMsg(termStatusAgentConnected, agentSessionID))
	case reconnecting:
		uc.writeJSON(statusMsg(termStatusAgentReconnecting, ""))
	default:
		uc.writeJSON(statusMsg(termStatusAgentWaiting, ""))
	}

	uc.prepareRead()
	stop := make(chan struct{})
	defer close(stop)
	go uc.keepalive(stop)

	for {
		var msg TerminalMessage
		if err := raw.ReadJSON(&msg); err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway, websocket.CloseNoStatusReceived) {
				log.Printf("Terminal read error (machine %s): %v", machineID, err)
			}
			return
		}
		raw.SetReadDeadline(time.Now().Add(terminalReadTimeout))

		switch msg.Type {
		case "input", "resize":
			if ac := session.agentConn(); ac != nil {
				// A failed write closes the agent socket; its read loop then
				// notifies users and the agent reconnects.
				ac.writeJSON(TerminalMessage{Type: msg.Type, Data: msg.Data, Cols: msg.Cols, Rows: msg.Rows})
			}
		case "ping":
			if err := uc.writeJSON(TerminalMessage{Type: "pong"}); err != nil {
				return
			}
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

	var machineID uuid.UUID
	if err := h.db.Get(&machineID, "SELECT id FROM machines WHERE agent_id = $1", agentID); err != nil {
		http.Error(w, "Machine not found", http.StatusNotFound)
		return
	}

	raw, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Failed to upgrade agent WebSocket: %v", err)
		return
	}
	ac := newWSConn(raw)
	log.Printf("Agent terminal connected for machine %s", machineID)

	session := h.getSession(machineID)
	session.mu.Lock()
	old := session.agent
	session.agent = ac
	session.AgentID = agentID
	if session.reconnectTimer != nil {
		session.reconnectTimer.Stop()
		session.reconnectTimer = nil
	}
	session.mu.Unlock()
	if old != nil {
		old.close()
	}
	// v2 agents follow up with shell_started/shell_resumed (+ session id).
	h.broadcast(session, statusMsg(termStatusAgentConnected, ""))

	defer func() {
		ac.close()
		session.mu.Lock()
		current := session.agent == ac
		if current {
			session.agent = nil
			if session.reconnectTimer != nil {
				session.reconnectTimer.Stop()
			}
			session.reconnectTimer = time.AfterFunc(agentReconnectGrace, func() {
				session.mu.Lock()
				stillGone := session.agent == nil
				session.reconnectTimer = nil
				session.mu.Unlock()
				if stillGone {
					h.broadcast(session, statusMsg(termStatusAgentDisconnected, ""))
					h.cleanupSession(session)
				}
			})
		}
		session.mu.Unlock()
		log.Printf("Agent terminal disconnected for machine %s", machineID)
		if current {
			h.broadcast(session, statusMsg(termStatusAgentReconnecting, ""))
		}
		h.cleanupSession(session)
	}()

	ac.prepareRead()
	stop := make(chan struct{})
	defer close(stop)
	go ac.keepalive(stop)

	for {
		var msg TerminalMessage
		if err := raw.ReadJSON(&msg); err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway, websocket.CloseNoStatusReceived) {
				log.Printf("Agent terminal read error (machine %s): %v", machineID, err)
			}
			return
		}
		raw.SetReadDeadline(time.Now().Add(terminalReadTimeout))

		switch msg.Type {
		case "output":
			h.broadcast(session, msg)
		case "status":
			// shell_started / shell_resumed / shell_exited from the agent
			if msg.SessionID != "" {
				session.mu.Lock()
				session.agentSessionID = msg.SessionID
				session.mu.Unlock()
			}
			if msg.Data == "shell_started" || msg.Data == "shell_resumed" {
				h.broadcast(session, statusMsg(termStatusAgentConnected, msg.SessionID))
			}
			h.broadcast(session, msg)
		case "ping":
			if err := ac.writeJSON(TerminalMessage{Type: "pong"}); err != nil {
				return
			}
		case "pong":
		}
	}
}

// GetTerminalStatus returns current terminal session status for a machine
func (h *TerminalHandler) GetTerminalStatus(w http.ResponseWriter, r *http.Request) {
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	h.sessionsLock.Lock()
	session, exists := h.sessions[machineID]
	h.sessionsLock.Unlock()

	status := map[string]interface{}{
		"has_session":      exists,
		"agent_connected":  false,
		"users_connected":  0,
		"agent_session_id": "",
	}
	if exists {
		session.mu.Lock()
		status["agent_connected"] = session.agent != nil
		status["users_connected"] = len(session.users)
		status["agent_session_id"] = session.agentSessionID
		session.mu.Unlock()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}
