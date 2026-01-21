package database

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/lib/pq"
	"github.com/jmoiron/sqlx"
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
	// Migration files to run in order
	migrations := []string{
		"001_initial_schema.sql",
		"002_add_notes_and_token_name.sql",
		"003_machine_settings.sql",
	}

	// Base paths to try
	basePaths := []string{
		"migrations/",
		"backend/migrations/",
		filepath.Join(filepath.Dir(os.Args[0]), "migrations/"),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	for _, migration := range migrations {
		var migrationSQL []byte
		var err error

		for _, basePath := range basePaths {
			migrationSQL, err = os.ReadFile(basePath + migration)
			if err == nil {
				break
			}
		}
		if err != nil {
			// Skip missing migrations (may already be applied)
			continue
		}

		// Run migration
		if _, err := db.ExecContext(ctx, string(migrationSQL)); err != nil {
			// Ignore errors from already-applied migrations (e.g., "already exists")
			if !strings.Contains(err.Error(), "already exists") &&
				!strings.Contains(err.Error(), "duplicate") {
				return fmt.Errorf("failed to run migration %s: %w", migration, err)
			}
		}
	}

	return nil
}

func (db *DB) Close() error {
	return db.DB.Close()
}
