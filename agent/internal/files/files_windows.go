//go:build windows
// +build windows

package files

// RunFileLoop is a no-op on Windows (file operations not supported)
func RunFileLoop(serverURL, apiKey string) {
	// File operations only supported on Linux/macOS
}

