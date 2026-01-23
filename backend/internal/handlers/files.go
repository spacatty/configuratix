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

// FileOperation represents a file operation request/response
type FileOperation struct {
	ID        string      `json:"id"`
	Type      string      `json:"type"` // list, read, write, exists, stat
	Path      string      `json:"path,omitempty"`
	Content   string      `json:"content,omitempty"`
	Recursive bool        `json:"recursive,omitempty"`
	Result    interface{} `json:"result,omitempty"`
	Error     string      `json:"error,omitempty"`
	Success   bool        `json:"success"`
}

// FileInfo represents file metadata
type FileInfo struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	IsDir   bool   `json:"is_dir"`
	Size    int64  `json:"size"`
	Mode    string `json:"mode"`
	ModTime string `json:"mod_time"`
}

// FileSession represents an active file handler session for a machine
type FileSession struct {
	MachineID uuid.UUID
	AgentID   uuid.UUID
	agentConn *websocket.Conn
	connLock  sync.Mutex
	// Pending requests waiting for response
	pending     map[string]chan FileOperation
	pendingLock sync.Mutex
}

// FilesHandler handles file operations via WebSocket
type FilesHandler struct {
	db           *database.DB
	sessions     map[uuid.UUID]*FileSession
	sessionsLock sync.RWMutex
}

// NewFilesHandler creates a new FilesHandler
func NewFilesHandler(db *database.DB) *FilesHandler {
	return &FilesHandler{
		db:       db,
		sessions: make(map[uuid.UUID]*FileSession),
	}
}

// AgentFileConnect handles WebSocket connection from agent
func (h *FilesHandler) AgentFileConnect(w http.ResponseWriter, r *http.Request) {
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
		log.Printf("Failed to upgrade agent file WebSocket: %v", err)
		return
	}
	defer conn.Close()

	log.Printf("Agent file handler connected for machine %s", machineID)

	// Configure ping/pong
	conn.SetPongHandler(func(appData string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	// Get or create session
	h.sessionsLock.Lock()
	session, exists := h.sessions[machineID]
	if !exists {
		session = &FileSession{
			MachineID: machineID,
			AgentID:   agentID,
			pending:   make(map[string]chan FileOperation),
		}
		h.sessions[machineID] = session
	}
	session.AgentID = agentID
	h.sessionsLock.Unlock()

	// Set agent connection
	session.connLock.Lock()
	oldConn := session.agentConn
	session.agentConn = conn
	session.connLock.Unlock()

	if oldConn != nil {
		oldConn.Close()
	}

	defer func() {
		session.connLock.Lock()
		if session.agentConn == conn {
			session.agentConn = nil
		}
		session.connLock.Unlock()
		log.Printf("Agent file handler disconnected for machine %s", machineID)
	}()

	// Set initial read deadline
	conn.SetReadDeadline(time.Now().Add(60 * time.Second))

	// Keepalive ping goroutine
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				session.connLock.Lock()
				if session.agentConn != nil {
					session.agentConn.SetWriteDeadline(time.Now().Add(5 * time.Second))
					err := session.agentConn.WriteMessage(websocket.PingMessage, []byte("keepalive"))
					session.connLock.Unlock()
					if err != nil {
						return
					}
				} else {
					session.connLock.Unlock()
					return
				}
			}
		}
	}()
	defer close(done)

	// Read responses from agent
	for {
		var op FileOperation
		if err := conn.ReadJSON(&op); err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				break
			}
			log.Printf("Agent file read error: %v", err)
			break
		}

		// Extend read deadline
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))

		// Route response to waiting request
		session.pendingLock.Lock()
		if ch, exists := session.pending[op.ID]; exists {
			ch <- op
			delete(session.pending, op.ID)
		}
		session.pendingLock.Unlock()
	}
}

// ExecuteFileOperation sends a file operation to an agent and waits for response
func (h *FilesHandler) ExecuteFileOperation(machineID uuid.UUID, op FileOperation, timeout time.Duration) (FileOperation, error) {
	h.sessionsLock.RLock()
	session, exists := h.sessions[machineID]
	h.sessionsLock.RUnlock()

	if !exists || session == nil {
		return FileOperation{Success: false, Error: "File handler not connected"}, nil
	}

	session.connLock.Lock()
	if session.agentConn == nil {
		session.connLock.Unlock()
		return FileOperation{Success: false, Error: "Agent not connected"}, nil
	}

	// Generate request ID
	op.ID = uuid.New().String()

	// Create response channel
	responseChan := make(chan FileOperation, 1)
	session.pendingLock.Lock()
	session.pending[op.ID] = responseChan
	session.pendingLock.Unlock()

	// Cleanup on exit
	defer func() {
		session.pendingLock.Lock()
		delete(session.pending, op.ID)
		session.pendingLock.Unlock()
	}()

	// Send request
	session.agentConn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	err := session.agentConn.WriteJSON(op)
	session.connLock.Unlock()

	if err != nil {
		return FileOperation{Success: false, Error: "Failed to send request: " + err.Error()}, nil
	}

	// Wait for response
	select {
	case response := <-responseChan:
		return response, nil
	case <-time.After(timeout):
		return FileOperation{Success: false, Error: "Timeout waiting for response"}, nil
	}
}

// API Handlers for frontend

// ListDirectory lists files in a directory
func (h *FilesHandler) ListDirectory(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	// Verify access
	if !h.verifyMachineAccess(machineID, userID, claims.IsSuperAdmin()) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	recursive := r.URL.Query().Get("recursive") == "true"

	result, err := h.ExecuteFileOperation(machineID, FileOperation{
		Type:      "list",
		Path:      path,
		Recursive: recursive,
	}, 10*time.Second)

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// ReadFile reads a file's content
func (h *FilesHandler) ReadFile(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	// Verify access
	if !h.verifyMachineAccess(machineID, userID, claims.IsSuperAdmin()) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	result, err := h.ExecuteFileOperation(machineID, FileOperation{
		Type: "read",
		Path: path,
	}, 15*time.Second)

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// WriteFile writes content to a file
func (h *FilesHandler) WriteFile(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	// Verify access
	if !h.verifyMachineAccess(machineID, userID, claims.IsSuperAdmin()) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	result, err := h.ExecuteFileOperation(machineID, FileOperation{
		Type:    "write",
		Path:    req.Path,
		Content: req.Content,
	}, 15*time.Second)

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// FileExists checks if a file exists
func (h *FilesHandler) FileExists(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	// Verify access
	if !h.verifyMachineAccess(machineID, userID, claims.IsSuperAdmin()) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	result, err := h.ExecuteFileOperation(machineID, FileOperation{
		Type: "exists",
		Path: path,
	}, 5*time.Second)

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *FilesHandler) verifyMachineAccess(machineID, userID uuid.UUID, isSuperAdmin bool) bool {
	if isSuperAdmin {
		return true
	}

	var exists bool
	h.db.Get(&exists, `
		SELECT EXISTS(
			SELECT 1 FROM machines WHERE id = $1 AND owner_id = $2
			UNION
			SELECT 1 FROM machines m JOIN projects p ON m.project_id = p.id WHERE m.id = $1 AND p.owner_id = $2
			UNION
			SELECT 1 FROM machines m JOIN project_members pm ON m.project_id = pm.project_id WHERE m.id = $1 AND pm.user_id = $2 AND pm.status = 'approved'
		)
	`, machineID, userID)
	return exists
}

// GetFileSessionStatus returns the status of the file handler session for a machine
func (h *FilesHandler) GetFileSessionStatus(w http.ResponseWriter, r *http.Request) {
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	h.sessionsLock.RLock()
	session, exists := h.sessions[machineID]
	h.sessionsLock.RUnlock()

	status := map[string]interface{}{
		"connected": false,
	}

	if exists && session != nil {
		session.connLock.Lock()
		status["connected"] = session.agentConn != nil
		session.connLock.Unlock()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

