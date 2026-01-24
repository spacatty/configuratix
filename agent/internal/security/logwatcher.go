// +build linux

package security

import (
	"bufio"
	"io"
	"log"
	"os"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
)

// BlockedRequestHandler is called when a blocked request is detected
type BlockedRequestHandler func(ip, reason, userAgent, path string)

// LogWatcher watches the nginx security log for blocked requests
type LogWatcher struct {
	logPath string
	handler BlockedRequestHandler
	stopCh  chan struct{}
	stopped bool
}

// NewLogWatcher creates a new log watcher
func NewLogWatcher(logPath string, handler BlockedRequestHandler) *LogWatcher {
	if logPath == "" {
		logPath = "/var/log/nginx/security-blocked.log"
	}
	return &LogWatcher{
		logPath: logPath,
		handler: handler,
		stopCh:  make(chan struct{}),
	}
}

// Watch starts watching the log file
func (w *LogWatcher) Watch() {
	// Wait for log file to exist
	for !w.stopped {
		if _, err := os.Stat(w.logPath); err == nil {
			break
		}
		log.Printf("Waiting for security log file: %s", w.logPath)
		select {
		case <-time.After(30 * time.Second):
		case <-w.stopCh:
			return
		}
	}

	// Open file
	file, err := os.Open(w.logPath)
	if err != nil {
		log.Printf("Failed to open security log: %v", err)
		return
	}
	defer file.Close()

	// Seek to end (don't process old entries)
	file.Seek(0, io.SeekEnd)

	// Create fsnotify watcher
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("Failed to create file watcher: %v", err)
		// Fallback to polling
		w.pollWatch(file)
		return
	}
	defer watcher.Close()

	// Watch the log file
	if err := watcher.Add(w.logPath); err != nil {
		log.Printf("Failed to watch log file: %v", err)
		w.pollWatch(file)
		return
	}

	reader := bufio.NewReader(file)
	log.Printf("Watching security log: %s", w.logPath)

	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			if event.Op&fsnotify.Write == fsnotify.Write {
				w.readNewLines(reader)
			}
			if event.Op&fsnotify.Remove == fsnotify.Remove {
				// Log file was rotated, reopen
				log.Println("Security log rotated, reopening...")
				file.Close()
				time.Sleep(100 * time.Millisecond)
				
				newFile, err := os.Open(w.logPath)
				if err != nil {
					log.Printf("Failed to reopen security log: %v", err)
					return
				}
				file = newFile
				reader = bufio.NewReader(file)
				watcher.Add(w.logPath)
			}
		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			log.Printf("File watcher error: %v", err)
		case <-w.stopCh:
			return
		}
	}
}

// pollWatch is a fallback for when fsnotify doesn't work
func (w *LogWatcher) pollWatch(file *os.File) {
	reader := bufio.NewReader(file)
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			w.readNewLines(reader)
		case <-w.stopCh:
			return
		}
	}
}

// readNewLines reads and processes new lines from the log
func (w *LogWatcher) readNewLines(reader *bufio.Reader) {
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err != io.EOF {
				log.Printf("Error reading security log: %v", err)
			}
			break
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		w.parseLine(line)
	}
}

// parseLine parses a security log line
// Supports two formats:
// 1. Custom format: IP|REASON|USER_AGENT|PATH|TIMESTAMP
// 2. Combined log format: 192.168.1.1 - - [24/Jan/2026:01:23:45 +0000] "GET /path HTTP/1.1" 403 ...
func (w *LogWatcher) parseLine(line string) {
	// Try custom pipe-delimited format first
	if strings.Contains(line, "|") && strings.Count(line, "|") >= 3 {
		parts := strings.Split(line, "|")
		if len(parts) >= 4 {
			ip := strings.TrimSpace(parts[0])
			reason := strings.TrimSpace(parts[1])
			userAgent := strings.TrimSpace(parts[2])
			path := strings.TrimSpace(parts[3])

			if ip != "" && reason != "" {
				w.handler(ip, reason, userAgent, path)
				return
			}
		}
	}

	// Parse combined/common log format
	// Format: IP - - [date] "METHOD PATH PROTO" STATUS SIZE "REFERER" "USER_AGENT"
	ip := w.parseNginxCombinedLog(line)
	if ip != "" {
		// Extract path and user agent from the log line
		path := "-"
		userAgent := "-"
		
		// Extract request (between first and second quotes)
		if idx := strings.Index(line, "\""); idx != -1 {
			rest := line[idx+1:]
			if endIdx := strings.Index(rest, "\""); endIdx != -1 {
				request := rest[:endIdx]
				parts := strings.Split(request, " ")
				if len(parts) >= 2 {
					path = parts[1]
				}
			}
		}
		
		// Extract user agent (last quoted string)
		parts := strings.Split(line, "\"")
		if len(parts) >= 6 {
			userAgent = parts[5] // User agent is typically the 6th part
		}
		
		// All requests in this log are blocked, infer reason from context
		reason := "blocked_request"
		w.handler(ip, reason, userAgent, path)
	}
}

// parseNginxCombinedLog extracts the IP from a combined log format line
func (w *LogWatcher) parseNginxCombinedLog(line string) string {
	// Combined format starts with IP address
	parts := strings.SplitN(line, " ", 2)
	if len(parts) < 2 {
		return ""
	}
	
	ip := parts[0]
	// Validate it looks like an IP
	if strings.Contains(ip, ".") || strings.Contains(ip, ":") {
		return ip
	}
	return ""
}

// Stop stops the log watcher
func (w *LogWatcher) Stop() {
	if w.stopped {
		return
	}
	w.stopped = true
	close(w.stopCh)
}

