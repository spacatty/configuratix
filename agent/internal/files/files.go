//go:build linux || darwin
// +build linux darwin

package files

import (
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

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

// FileHandler handles file operations via WebSocket
type FileHandler struct {
	serverURL string
	apiKey    string
	conn      *websocket.Conn
	connLock  sync.Mutex
	done      chan struct{}
}

// New creates a new FileHandler
func New(serverURL, apiKey string) *FileHandler {
	return &FileHandler{
		serverURL: serverURL,
		apiKey:    apiKey,
		done:      make(chan struct{}),
	}
}

// Connect establishes WebSocket connection to backend file endpoint
func (f *FileHandler) Connect() error {
	wsURL := f.serverURL
	wsURL = strings.Replace(wsURL, "https://", "wss://", 1)
	wsURL = strings.Replace(wsURL, "http://", "ws://", 1)

	u, err := url.Parse(wsURL + "/api/agent/files")
	if err != nil {
		return err
	}

	header := http.Header{}
	header.Set("X-API-Key", f.apiKey)

	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	conn, _, err := dialer.Dial(u.String(), header)
	if err != nil {
		return err
	}

	f.connLock.Lock()
	f.conn = conn
	f.connLock.Unlock()

	return nil
}

// Run starts the file handler loop
func (f *FileHandler) Run() error {
	defer f.Close()

	// Set up ping/pong handlers
	f.conn.SetPongHandler(func(appData string) error {
		f.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	f.conn.SetPingHandler(func(appData string) error {
		f.connLock.Lock()
		defer f.connLock.Unlock()
		if f.conn != nil {
			f.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			return f.conn.WriteMessage(websocket.PongMessage, []byte(appData))
		}
		return nil
	})

	// Set initial read deadline
	f.conn.SetReadDeadline(time.Now().Add(60 * time.Second))

	// Start keepalive
	go f.keepalive()

	// Main loop: read requests, process, respond
	for {
		select {
		case <-f.done:
			return nil
		default:
			var op FileOperation
			if err := f.conn.ReadJSON(&op); err != nil {
				if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
					return nil
				}
				return err
			}

			// Extend read deadline
			f.conn.SetReadDeadline(time.Now().Add(60 * time.Second))

			// Process operation
			response := f.processOperation(op)

			// Send response
			f.sendResponse(response)
		}
	}
}

func (f *FileHandler) processOperation(op FileOperation) FileOperation {
	response := FileOperation{
		ID:   op.ID,
		Type: op.Type,
		Path: op.Path,
	}

	// Security: validate path
	if !isAllowedPath(op.Path) {
		response.Error = "Access denied: path not allowed"
		response.Success = false
		return response
	}

	switch op.Type {
	case "list":
		files, err := f.listDirectory(op.Path, op.Recursive)
		if err != nil {
			response.Error = err.Error()
			response.Success = false
		} else {
			response.Result = files
			response.Success = true
		}

	case "read":
		content, err := f.readFile(op.Path)
		if err != nil {
			response.Error = err.Error()
			response.Success = false
		} else {
			response.Content = content
			response.Success = true
		}

	case "write":
		err := f.writeFile(op.Path, op.Content)
		if err != nil {
			response.Error = err.Error()
			response.Success = false
		} else {
			response.Success = true
		}

	case "exists":
		exists := f.fileExists(op.Path)
		response.Result = exists
		response.Success = true

	case "stat":
		info, err := f.fileStat(op.Path)
		if err != nil {
			response.Error = err.Error()
			response.Success = false
		} else {
			response.Result = info
			response.Success = true
		}

	default:
		response.Error = "Unknown operation type"
		response.Success = false
	}

	return response
}

func (f *FileHandler) listDirectory(path string, recursive bool) ([]FileInfo, error) {
	var files []FileInfo

	if recursive {
		err := filepath.WalkDir(path, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil // Skip errors
			}
			info, _ := d.Info()
			if info != nil {
				files = append(files, FileInfo{
					Name:    d.Name(),
					Path:    p,
					IsDir:   d.IsDir(),
					Size:    info.Size(),
					Mode:    info.Mode().String(),
					ModTime: info.ModTime().Format(time.RFC3339),
				})
			}
			return nil
		})
		return files, err
	}

	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}

	for _, entry := range entries {
		info, _ := entry.Info()
		fullPath := filepath.Join(path, entry.Name())
		if info != nil {
			files = append(files, FileInfo{
				Name:    entry.Name(),
				Path:    fullPath,
				IsDir:   entry.IsDir(),
				Size:    info.Size(),
				Mode:    info.Mode().String(),
				ModTime: info.ModTime().Format(time.RFC3339),
			})
		}
	}

	return files, nil
}

func (f *FileHandler) readFile(path string) (string, error) {
	// Limit file size to 10MB
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if info.Size() > 10*1024*1024 {
		return "", os.ErrInvalid
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(content), nil
}

func (f *FileHandler) writeFile(path string, content string) error {
	// Get existing permissions or use default
	mode := os.FileMode(0644)
	if info, err := os.Stat(path); err == nil {
		mode = info.Mode()
	}

	return os.WriteFile(path, []byte(content), mode)
}

func (f *FileHandler) fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func (f *FileHandler) fileStat(path string) (*FileInfo, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	return &FileInfo{
		Name:    info.Name(),
		Path:    path,
		IsDir:   info.IsDir(),
		Size:    info.Size(),
		Mode:    info.Mode().String(),
		ModTime: info.ModTime().Format(time.RFC3339),
	}, nil
}

func (f *FileHandler) sendResponse(op FileOperation) error {
	f.connLock.Lock()
	defer f.connLock.Unlock()

	if f.conn == nil {
		return nil
	}

	f.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return f.conn.WriteJSON(op)
}

func (f *FileHandler) keepalive() {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-f.done:
			return
		case <-ticker.C:
			f.connLock.Lock()
			if f.conn != nil {
				f.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
				if err := f.conn.WriteMessage(websocket.PingMessage, []byte("keepalive")); err != nil {
					log.Printf("File handler ping failed: %v", err)
					f.connLock.Unlock()
					return
				}
			}
			f.connLock.Unlock()
		}
	}
}

func (f *FileHandler) Close() {
	close(f.done)

	f.connLock.Lock()
	if f.conn != nil {
		f.conn.Close()
		f.conn = nil
	}
	f.connLock.Unlock()
}

// isAllowedPath checks if a path is allowed to be accessed
func isAllowedPath(path string) bool {
	// Clean the path
	path = filepath.Clean(path)

	// Allow common config directories
	allowedPrefixes := []string{
		"/etc/nginx/",
		"/etc/php/",
		"/etc/ssh/",
		"/etc/fail2ban/",
		"/etc/ufw/",
		"/etc/letsencrypt/",
		"/var/log/",
		"/root/.ssh/",
		"/home/",
	}

	for _, prefix := range allowedPrefixes {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}

	// Also allow exact matches for some files
	allowedFiles := []string{
		"/etc/nginx/nginx.conf",
		"/etc/ssh/sshd_config",
	}

	for _, file := range allowedFiles {
		if path == file {
			return true
		}
	}

	return false
}

// RunFileLoop continuously maintains file handler connection with reconnection
func RunFileLoop(serverURL, apiKey string) {
	for {
		handler := New(serverURL, apiKey)
		if err := handler.Connect(); err != nil {
			log.Printf("File handler connection failed: %v, retrying in 5s", err)
			time.Sleep(5 * time.Second)
			continue
		}

		log.Println("File handler connected")
		if err := handler.Run(); err != nil {
			log.Printf("File handler error: %v", err)
		}
		log.Println("File handler disconnected, reconnecting...")
		time.Sleep(2 * time.Second)
	}
}

