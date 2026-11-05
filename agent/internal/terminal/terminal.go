//go:build linux || darwin
// +build linux darwin

package terminal

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

// Keepalive discipline (same on every leg of browser <-> backend <-> agent):
// control-frame ping every pingInterval, read deadline readTimeout refreshed
// on pong and on any received message, every write with a fresh deadline,
// any write error closes the connection.
const (
	pingInterval = 20 * time.Second
	readTimeout  = 70 * time.Second
	writeTimeout = 10 * time.Second
	// Output produced while the backend link is down is kept and replayed.
	maxPending = 256 * 1024
)

type TerminalMessage struct {
	Type      string `json:"type"` // input, output, resize, ping, pong, status
	Data      string `json:"data,omitempty"`
	Cols      int    `json:"cols,omitempty"`
	Rows      int    `json:"rows,omitempty"`
	SessionID string `json:"session_id,omitempty"`
}

// wsConn serialises writes on one websocket (gorilla allows one writer).
type wsConn struct {
	conn   *websocket.Conn
	mu     sync.Mutex
	closed bool
	once   sync.Once
}

func (c *wsConn) writeJSON(v interface{}) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return errors.New("connection closed")
	}
	c.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
	if err := c.conn.WriteJSON(v); err != nil {
		c.closed = true
		c.conn.Close()
		return err
	}
	return nil
}

func (c *wsConn) ping() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return errors.New("connection closed")
	}
	if err := c.conn.WriteControl(websocket.PingMessage, []byte("keepalive"), time.Now().Add(writeTimeout)); err != nil {
		c.closed = true
		c.conn.Close()
		return err
	}
	return nil
}

func (c *wsConn) close() {
	c.once.Do(func() {
		c.mu.Lock()
		c.closed = true
		c.mu.Unlock()
		c.conn.Close()
	})
}

// shell is a PTY-backed login shell that survives backend reconnects.
type shell struct {
	id   string
	pty  *os.File
	cmd  *exec.Cmd
	done chan struct{}
}

type manager struct {
	serverURL string
	apiKey    string

	mu      sync.Mutex
	conn    *wsConn
	sh      *shell
	pending []byte
	cols    int
	rows    int
}

func newID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (m *manager) startShell() (*shell, error) {
	sh := os.Getenv("SHELL")
	if sh == "" {
		sh = "/bin/bash"
	}
	cmd := exec.Command(sh)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	f, err := pty.Start(cmd)
	if err != nil {
		return nil, err
	}
	s := &shell{id: newID(), pty: f, cmd: cmd, done: make(chan struct{})}
	cols, rows := m.cols, m.rows
	if cols <= 0 || rows <= 0 {
		cols, rows = 80, 24
	}
	pty.Setsize(f, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	go m.pump(s)
	go func() {
		cmd.Wait()
		f.Close()
		close(s.done)
	}()
	return s, nil
}

// pump copies PTY output to the current connection (or the pending buffer).
func (m *manager) pump(s *shell) {
	buf := make([]byte, 8192)
	for {
		n, err := s.pty.Read(buf)
		if n > 0 {
			m.emit(s, string(buf[:n]))
		}
		if err != nil {
			break
		}
	}
	m.mu.Lock()
	if m.sh == s {
		m.sh = nil
	}
	conn := m.conn
	m.mu.Unlock()
	if conn != nil {
		conn.writeJSON(TerminalMessage{Type: "status", Data: "shell_exited", SessionID: s.id})
	}
}

func (m *manager) emit(s *shell, data string) {
	m.mu.Lock()
	conn := m.conn
	if conn == nil {
		m.pending = append(m.pending, data...)
		if len(m.pending) > maxPending {
			m.pending = append([]byte(nil), m.pending[len(m.pending)-maxPending:]...)
		}
		m.mu.Unlock()
		return
	}
	m.mu.Unlock()
	if err := conn.writeJSON(TerminalMessage{Type: "output", Data: data, SessionID: s.id}); err != nil {
		// Keep the output for the next connection.
		m.mu.Lock()
		m.pending = append(m.pending, data...)
		m.mu.Unlock()
	}
}

// ensureShell returns the live shell, starting a new one if needed.
func (m *manager) ensureShell() (*shell, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sh != nil {
		select {
		case <-m.sh.done:
			m.sh = nil
		default:
			return m.sh, true, nil
		}
	}
	s, err := m.startShell()
	if err != nil {
		return nil, false, err
	}
	m.sh = s
	return s, false, nil
}

func (m *manager) dial() (*wsConn, error) {
	wsURL := m.serverURL
	wsURL = strings.Replace(wsURL, "https://", "wss://", 1)
	wsURL = strings.Replace(wsURL, "http://", "ws://", 1)
	u, err := url.Parse(wsURL + "/api/agent/terminal")
	if err != nil {
		return nil, err
	}
	header := http.Header{}
	header.Set("X-API-Key", m.apiKey)
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, _, err := dialer.Dial(u.String(), header)
	if err != nil {
		return nil, err
	}
	return &wsConn{conn: conn}, nil
}

// serve runs one backend connection until it breaks. The shell keeps running.
func (m *manager) serve(c *wsConn) {
	defer c.close()
	conn := c.conn

	conn.SetReadDeadline(time.Now().Add(readTimeout))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(readTimeout))
		return nil
	})
	conn.SetPingHandler(func(appData string) error {
		conn.SetReadDeadline(time.Now().Add(readTimeout))
		err := conn.WriteControl(websocket.PongMessage, []byte(appData), time.Now().Add(writeTimeout))
		if err != nil && !errors.Is(err, websocket.ErrCloseSent) {
			c.close()
		}
		return nil
	})

	s, resumed, err := m.ensureShell()
	if err != nil {
		c.writeJSON(TerminalMessage{Type: "output", Data: "\r\n\x1b[31mFailed to start shell: " + err.Error() + "\x1b[0m\r\n"})
		return
	}
	status := "shell_started"
	if resumed {
		status = "shell_resumed"
	}
	if err := c.writeJSON(TerminalMessage{Type: "status", Data: status, SessionID: s.id}); err != nil {
		return
	}

	// Attach: flush output produced while disconnected, then go live.
	// The flush happens under the lock so live output can't overtake it.
	m.mu.Lock()
	if len(m.pending) > 0 {
		if err := c.writeJSON(TerminalMessage{Type: "output", Data: string(m.pending), SessionID: s.id}); err != nil {
			m.mu.Unlock()
			return
		}
		m.pending = nil
	}
	m.conn = c
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		if m.conn == c {
			m.conn = nil
		}
		m.mu.Unlock()
	}()

	stop := make(chan struct{})
	defer close(stop)
	go func() {
		t := time.NewTicker(pingInterval)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				if err := c.ping(); err != nil {
					log.Printf("Terminal ping failed: %v", err)
					return
				}
			}
		}
	}()

	for {
		var msg TerminalMessage
		if err := conn.ReadJSON(&msg); err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				log.Printf("Terminal read error: %v", err)
			}
			return
		}
		conn.SetReadDeadline(time.Now().Add(readTimeout))

		switch msg.Type {
		case "input":
			sh, resumedNow, err := m.ensureShell()
			if err != nil {
				continue
			}
			if !resumedNow {
				c.writeJSON(TerminalMessage{Type: "status", Data: "shell_started", SessionID: sh.id})
			}
			sh.pty.Write([]byte(msg.Data))
		case "resize":
			if msg.Cols > 0 && msg.Rows > 0 {
				m.mu.Lock()
				m.cols, m.rows = msg.Cols, msg.Rows
				sh := m.sh
				m.mu.Unlock()
				if sh != nil {
					pty.Setsize(sh.pty, &pty.Winsize{Rows: uint16(msg.Rows), Cols: uint16(msg.Cols)})
				}
			}
		case "ping":
			c.writeJSON(TerminalMessage{Type: "pong"})
		case "pong":
		}
	}
}

// RunTerminalLoop continuously maintains the terminal connection with
// exponential-backoff reconnects. The PTY session persists across reconnects.
func RunTerminalLoop(serverURL, apiKey string) {
	m := &manager{serverURL: serverURL, apiKey: apiKey}
	backoff := time.Second
	for {
		c, err := m.dial()
		if err != nil {
			log.Printf("Terminal connection failed: %v, retrying in %s", err, backoff)
			time.Sleep(backoff)
			if backoff < 30*time.Second {
				backoff *= 2
			}
			continue
		}
		log.Println("Terminal connected")
		started := time.Now()
		m.serve(c)
		log.Println("Terminal disconnected, reconnecting...")
		if time.Since(started) > 30*time.Second {
			backoff = time.Second
		}
		time.Sleep(backoff)
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}
