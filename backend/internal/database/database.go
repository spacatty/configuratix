package database

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
)

type DB struct {
	*sqlx.DB
}

func New() (*DB, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://postgres:postgres@localhost:5432/configuratix?sslmode=disable"
	}

	// Add connection timeout if not present (generous for remote/slow DBs)
	if !strings.Contains(dsn, "connect_timeout") {
		if strings.Contains(dsn, "?") {
			dsn += "&connect_timeout=30"
		} else {
			dsn += "?connect_timeout=30"
		}
	}

	db, err := sqlx.Connect("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	// Set connection pool settings
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	// Test connection with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &DB{db}, nil
}

func (db *DB) RunMigrations() error {
	// Get current working directory for debugging
	cwd, _ := os.Getwd()

	// Base paths to try - include absolute paths
	basePaths := []string{
		"migrations/",
		"backend/migrations/",
		"../migrations/",
		filepath.Join(filepath.Dir(os.Args[0]), "migrations/"),
		filepath.Join(filepath.Dir(os.Args[0]), "../migrations/"),
		filepath.Join(cwd, "migrations/"),
		filepath.Join(cwd, "backend/migrations/"),
	}

	// Find migrations directory
	var migrationsDir string
	for _, basePath := range basePaths {
		if info, err := os.Stat(basePath); err == nil && info.IsDir() {
			migrationsDir = basePath
			break
		}
	}

	if migrationsDir == "" {
		return fmt.Errorf("migrations directory not found (cwd: %s); run the server or `go run ./cmd/migrate` from the backend folder, or set cwd so backend/migrations is discoverable", cwd)
	}

	// Read all .sql files from the migrations directory
	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		return fmt.Errorf("failed to read migrations directory: %w", err)
	}

	// Filter and sort migration files
	var migrations []string
	for _, entry := range entries {
		name := entry.Name()
		// Skip directories, non-SQL files, and files starting with "_"
		if entry.IsDir() || !strings.HasSuffix(name, ".sql") || strings.HasPrefix(name, "_") {
			continue
		}
		migrations = append(migrations, name)
	}

	// Sort migrations alphabetically (they should be numbered like 001_, 002_, etc.)
	sort.Strings(migrations)

	// Per-migration timeout: generous for remote/slow DBs (e.g. 002 can be large)
	perMigrationTimeout := 3 * time.Minute
	if s := os.Getenv("MIGRATION_TIMEOUT_SECONDS"); s != "" {
		var sec int
		if _, err := fmt.Sscanf(s, "%d", &sec); err == nil && sec > 0 {
			perMigrationTimeout = time.Duration(sec) * time.Second
		}
	}
	migrationRetryDelay := 5 * time.Second
	if s := os.Getenv("MIGRATION_RETRY_DELAY_MS"); s != "" {
		var ms int
		if _, err := fmt.Sscanf(s, "%d", &ms); err == nil && ms >= 0 {
			migrationRetryDelay = time.Duration(ms) * time.Millisecond
		}
	}

	appliedCount := 0
	for _, migration := range migrations {
		fullPath := filepath.Join(migrationsDir, migration)
		migrationSQL, err := os.ReadFile(fullPath)
		if err != nil {
			fmt.Printf("Warning: Failed to read migration file: %s: %v\n", fullPath, err)
			continue
		}

		var execErr error
		for attempt := 0; attempt < 3; attempt++ {
			if attempt > 0 {
				time.Sleep(migrationRetryDelay)
			}
			ctx, cancel := context.WithTimeout(context.Background(), perMigrationTimeout)
			_, execErr = db.ExecContext(ctx, string(migrationSQL))
			cancel()
			if execErr == nil {
				break
			}
			errStr := execErr.Error()
			if strings.Contains(errStr, "already exists") || strings.Contains(errStr, "duplicate") {
				break // leave execErr set so we skip "Applied" and continue to next migration
			}
			// Retry on connection/timeout errors (e.g. flaky remote DB)
			if strings.Contains(errStr, "timeout") || strings.Contains(errStr, "connection") ||
				strings.Contains(errStr, "did not properly respond") || strings.Contains(errStr, "wsarecv") {
				if attempt < 2 {
					fmt.Printf("Migration %s attempt %d failed (will retry): %v\n", migration, attempt+1, execErr)
					continue
				}
			}
			break
		}
		if execErr != nil {
			errStr := execErr.Error()
			if strings.Contains(errStr, "already exists") || strings.Contains(errStr, "duplicate") {
				continue
			}
			return fmt.Errorf("failed to run migration %s: %w", migration, execErr)
		}
		fmt.Printf("Applied migration: %s (from %s)\n", migration, fullPath)
		appliedCount++
	}

	if appliedCount > 0 {
		fmt.Printf("Applied %d migrations\n", appliedCount)
	}

	return nil
}

func (db *DB) Close() error {
	return db.DB.Close()
}
