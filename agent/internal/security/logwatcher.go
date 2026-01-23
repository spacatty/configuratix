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
// Expected format: IP|REASON|USER_AGENT|PATH|TIMESTAMP
func (w *LogWatcher) parseLine(line string) {
	parts := strings.Split(line, "|")
	if len(parts) < 4 {
		log.Printf("Invalid security log line: %s", line)
		return
	}

	ip := strings.TrimSpace(parts[0])
	reason := strings.TrimSpace(parts[1])
	userAgent := strings.TrimSpace(parts[2])
	path := strings.TrimSpace(parts[3])

	if ip == "" || reason == "" {
		return
	}

	// Call handler
	w.handler(ip, reason, userAgent, path)
}

// Stop stops the log watcher
func (w *LogWatcher) Stop() {
	if w.stopped {
		return
	}
	w.stopped = true
	close(w.stopCh)
}

