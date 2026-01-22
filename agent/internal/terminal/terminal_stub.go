// +build windows

package terminal

import "log"

// RunTerminalLoop is a no-op on Windows (agent runs on Linux)
func RunTerminalLoop(serverURL, apiKey string) {
	log.Println("Terminal not supported on Windows - agent is designed for Linux servers")
}

