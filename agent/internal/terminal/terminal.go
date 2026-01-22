//go:build linux || darwin
// +build linux darwin

package terminal

import (
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

type TerminalMessage struct {
	Type string `json:"type"` // input, output, resize, ping, pong, status
	Data string `json:"data,omitempty"`
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
}

type Terminal struct {
	serverURL string
	apiKey    string
	conn      *websocket.Conn
	connLock  sync.Mutex
	ptyFile   *os.File
	cmd       *exec.Cmd
	done      chan struct{}
}

func New(serverURL, apiKey string) *Terminal {
	return &Terminal{
		serverURL: serverURL,
		apiKey:    apiKey,
		done:      make(chan struct{}),
	}
}

// Connect establishes websocket connection to backend terminal endpoint
func (t *Terminal) Connect() error {
	// Convert http(s) to ws(s)
	wsURL := t.serverURL
	wsURL = strings.Replace(wsURL, "https://", "wss://", 1)
	wsURL = strings.Replace(wsURL, "http://", "ws://", 1)

	u, err := url.Parse(wsURL + "/api/agent/terminal")
	if err != nil {
		return err
	}

	header := http.Header{}
	header.Set("X-API-Key", t.apiKey)

	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	conn, _, err := dialer.Dial(u.String(), header)
	if err != nil {
		return err
	}

	t.connLock.Lock()
	t.conn = conn
	t.connLock.Unlock()

	return nil
}

// Run starts the terminal session
func (t *Terminal) Run() error {
	defer t.Close()

	// Start shell
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}

	t.cmd = exec.Command(shell)
	t.cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	var err error
	t.ptyFile, err = pty.Start(t.cmd)
	if err != nil {
		return err
	}
	defer t.ptyFile.Close()

	// Set initial size
	t.setSize(80, 24)

	// Goroutine: read from PTY, send to websocket
	go t.readFromPTY()

	// Goroutine: ping/pong keepalive
	go t.keepalive()

	// Main loop: read from websocket, write to PTY
	return t.readFromWebsocket()
}

func (t *Terminal) readFromPTY() {
	buf := make([]byte, 4096)
	for {
		select {
		case <-t.done:
			return
		default:
			n, err := t.ptyFile.Read(buf)
			if err != nil {
				return
			}
			if n > 0 {
				t.sendMessage(TerminalMessage{
					Type: "output",
					Data: string(buf[:n]),
				})
			}
		}
	}
}

func (t *Terminal) readFromWebsocket() error {
	for {
		select {
		case <-t.done:
			return nil
		default:
			var msg TerminalMessage
			t.connLock.Lock()
			conn := t.conn
			t.connLock.Unlock()

			if conn == nil {
				return nil
			}

			if err := conn.ReadJSON(&msg); err != nil {
				if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
					return nil
				}
				return err
			}

			switch msg.Type {
			case "input":
				if t.ptyFile != nil {
					t.ptyFile.Write([]byte(msg.Data))
				}
			case "resize":
				t.setSize(msg.Cols, msg.Rows)
			case "ping":
				t.sendMessage(TerminalMessage{Type: "pong"})
			case "pong":
				// Keepalive response, ignore
			}
		}
	}
}

func (t *Terminal) keepalive() {
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-t.done:
			return
		case <-ticker.C:
			t.sendMessage(TerminalMessage{Type: "ping"})
		}
	}
}

func (t *Terminal) sendMessage(msg TerminalMessage) error {
	t.connLock.Lock()
	defer t.connLock.Unlock()

	if t.conn == nil {
		return nil
	}

	t.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return t.conn.WriteJSON(msg)
}

func (t *Terminal) setSize(cols, rows int) {
	if t.ptyFile == nil || cols <= 0 || rows <= 0 {
		return
	}

	pty.Setsize(t.ptyFile, &pty.Winsize{
		Rows: uint16(rows),
		Cols: uint16(cols),
	})
}

func (t *Terminal) Close() {
	close(t.done)

	t.connLock.Lock()
	if t.conn != nil {
		t.conn.Close()
		t.conn = nil
	}
	t.connLock.Unlock()

	if t.ptyFile != nil {
		t.ptyFile.Close()
	}

	if t.cmd != nil && t.cmd.Process != nil {
		t.cmd.Process.Kill()
	}
}

// RunTerminalLoop continuously maintains terminal connection with reconnection
func RunTerminalLoop(serverURL, apiKey string) {
	for {
		term := New(serverURL, apiKey)
		if err := term.Connect(); err != nil {
			log.Printf("Terminal connection failed: %v, retrying in 5s", err)
			time.Sleep(5 * time.Second)
			continue
		}

		log.Println("Terminal connected")
		if err := term.Run(); err != nil {
			log.Printf("Terminal error: %v", err)
		}
		log.Println("Terminal disconnected, reconnecting...")
		time.Sleep(2 * time.Second)
	}
}
