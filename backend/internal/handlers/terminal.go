package handlers

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os/exec"
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

type TerminalSession struct {
	MachineID uuid.UUID
	AgentID   uuid.UUID
	UserID    uuid.UUID

	// Pending commands from user
	pendingCmds chan string
	// Output from agent
	outputChan chan string
	// Active connections
	userConns     []*websocket.Conn
	userConnsLock sync.Mutex

	ctx    context.Context
	cancel context.CancelFunc
}

type TerminalMessage struct {
	Type    string `json:"type"` // input, output, resize, ping
	Data    string `json:"data,omitempty"`
	Cols    int    `json:"cols,omitempty"`
	Rows    int    `json:"rows,omitempty"`
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
		ctx, cancel := context.WithCancel(context.Background())
		session = &TerminalSession{
			MachineID:   machineID,
			UserID:      userID,
			pendingCmds: make(chan string, 100),
			outputChan:  make(chan string, 1000),
			ctx:         ctx,
			cancel:      cancel,
		}
		h.sessions[machineID] = session
	}
	h.sessionsLock.Unlock()

	// Add this connection to session
	session.userConnsLock.Lock()
	session.userConns = append(session.userConns, conn)
	session.userConnsLock.Unlock()

	defer func() {
		session.userConnsLock.Lock()
		for i, c := range session.userConns {
			if c == conn {
				session.userConns = append(session.userConns[:i], session.userConns[i+1:]...)
				break
			}
		}
		session.userConnsLock.Unlock()
	}()

	// Send welcome message
	conn.WriteJSON(TerminalMessage{
		Type: "output",
		Data: "\r\n\x1b[32mConnected to terminal session.\x1b[0m\r\n\x1b[33mWaiting for agent connection...\x1b[0m\r\n",
	})

	// Handle incoming messages from user
	for {
		var msg TerminalMessage
		if err := conn.ReadJSON(&msg); err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				return
			}
			log.Printf("Terminal read error: %v", err)
			return
		}

		switch msg.Type {
		case "input":
			select {
			case session.pendingCmds <- msg.Data:
			default:
				// Buffer full, drop input
			}
		case "ping":
			conn.WriteJSON(TerminalMessage{Type: "pong"})
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

	// Get or create session
	h.sessionsLock.Lock()
	session, exists := h.sessions[machineID]
	if !exists {
		ctx, cancel := context.WithCancel(context.Background())
		session = &TerminalSession{
			MachineID:   machineID,
			AgentID:     agentID,
			pendingCmds: make(chan string, 100),
			outputChan:  make(chan string, 1000),
			ctx:         ctx,
			cancel:      cancel,
		}
		h.sessions[machineID] = session
	}
	session.AgentID = agentID
	h.sessionsLock.Unlock()

	// Notify users that agent connected
	h.broadcastToUsers(session, TerminalMessage{
		Type: "output",
		Data: "\r\n\x1b[32mAgent connected. Terminal ready.\x1b[0m\r\n$ ",
	})

	// Start bash shell
	ctx, cancel := context.WithCancel(session.ctx)
	defer cancel()

	cmd := exec.CommandContext(ctx, "/bin/bash", "-i")
	cmd.Env = append(cmd.Env, "TERM=xterm-256color", "PS1=\\u@\\h:\\w\\$ ")

	stdin, err := cmd.StdinPipe()
	if err != nil {
		log.Printf("Failed to get stdin: %v", err)
		return
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Printf("Failed to get stdout: %v", err)
		return
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		log.Printf("Failed to get stderr: %v", err)
		return
	}

	if err := cmd.Start(); err != nil {
		log.Printf("Failed to start shell: %v", err)
		return
	}

	// Forward stdout to users
	go func() {
		reader := bufio.NewReader(stdout)
		buf := make([]byte, 4096)
		for {
			n, err := reader.Read(buf)
			if err != nil {
				if err != io.EOF {
					log.Printf("Stdout read error: %v", err)
				}
				return
			}
			h.broadcastToUsers(session, TerminalMessage{
				Type: "output",
				Data: string(buf[:n]),
			})
		}
	}()

	// Forward stderr to users
	go func() {
		reader := bufio.NewReader(stderr)
		buf := make([]byte, 4096)
		for {
			n, err := reader.Read(buf)
			if err != nil {
				if err != io.EOF {
					log.Printf("Stderr read error: %v", err)
				}
				return
			}
			h.broadcastToUsers(session, TerminalMessage{
				Type: "output",
				Data: string(buf[:n]),
			})
		}
	}()

	// Read commands from pendingCmds and send to shell
	go func() {
		for {
			select {
			case cmd := <-session.pendingCmds:
				stdin.Write([]byte(cmd))
			case <-ctx.Done():
				return
			}
		}
	}()

	// Read from WebSocket (agent may send terminal resize, etc)
	for {
		var msg TerminalMessage
		if err := conn.ReadJSON(&msg); err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				break
			}
			log.Printf("Agent terminal read error: %v", err)
			break
		}

		switch msg.Type {
		case "ping":
			conn.WriteJSON(TerminalMessage{Type: "pong"})
		}
	}

	// Cleanup
	cmd.Process.Kill()
	cmd.Wait()
}

func (h *TerminalHandler) broadcastToUsers(session *TerminalSession, msg TerminalMessage) {
	session.userConnsLock.Lock()
	defer session.userConnsLock.Unlock()

	data, _ := json.Marshal(msg)
	for _, conn := range session.userConns {
		conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			log.Printf("Failed to write to user conn: %v", err)
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

	h.sessionsLock.RLock()
	session, exists := h.sessions[machineID]
	h.sessionsLock.RUnlock()

	status := map[string]interface{}{
		"has_session":    exists,
		"agent_connected": false,
		"users_connected": 0,
	}

	if exists {
		status["agent_connected"] = session.AgentID != uuid.Nil
		session.userConnsLock.Lock()
		status["users_connected"] = len(session.userConns)
		session.userConnsLock.Unlock()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

