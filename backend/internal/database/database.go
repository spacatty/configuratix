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

	// Add connection timeout if not present
	if !strings.Contains(dsn, "connect_timeout") {
		if strings.Contains(dsn, "?") {
			dsn += "&connect_timeout=10"
		} else {
			dsn += "?connect_timeout=10"
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
		fmt.Printf("Warning: Migrations directory not found (cwd: %s)\n", cwd)
		return nil
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

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	appliedCount := 0
	for _, migration := range migrations {
		fullPath := filepath.Join(migrationsDir, migration)
		migrationSQL, err := os.ReadFile(fullPath)
		if err != nil {
			fmt.Printf("Warning: Failed to read migration file: %s: %v\n", fullPath, err)
			continue
		}

		// Run migration
		if _, err := db.ExecContext(ctx, string(migrationSQL)); err != nil {
			// Ignore errors from already-applied migrations (e.g., "already exists")
			if !strings.Contains(err.Error(), "already exists") &&
				!strings.Contains(err.Error(), "duplicate") {
				return fmt.Errorf("failed to run migration %s: %w", migration, err)
			}
		} else {
			fmt.Printf("Applied migration: %s (from %s)\n", migration, fullPath)
			appliedCount++
		}
	}

	if appliedCount > 0 {
		fmt.Printf("Applied %d migrations\n", appliedCount)
	}

	return nil
}

func (db *DB) Close() error {
	return db.DB.Close()
}
