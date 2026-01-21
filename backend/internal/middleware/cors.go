package middleware

import (
	"net/http"
	"os"
	"strings"
)

// CORSMiddleware handles CORS with configurable origins
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		
		// Get allowed origins from environment, default to localhost for dev
		allowedOrigins := os.Getenv("CORS_ALLOWED_ORIGINS")
		if allowedOrigins == "" {
			// Default: only allow localhost for development
			allowedOrigins = "http://localhost:3000,http://127.0.0.1:3000"
		}
		
		// Check if the request origin is allowed
		allowed := false
		for _, ao := range strings.Split(allowedOrigins, ",") {
			ao = strings.TrimSpace(ao)
			if ao == "*" || ao == origin {
				allowed = true
				break
			}
		}
		
		if allowed && origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key")
		w.Header().Set("Access-Control-Max-Age", "86400") // 24 hours

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}
