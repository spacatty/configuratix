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
		"004_users_projects_roles.sql",
		"005_landings.sql",
		"006_ufw_rules.sql",
		"012_php_runtimes.sql",
		"013_seed_php_templates.sql",
		"014_dns_providers.sql",
		"015_separate_dns_domains.sql",
		"016_machine_groups.sql",
		"017_config_categories.sql",
	}

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

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	appliedCount := 0
	for _, migration := range migrations {
		var migrationSQL []byte
		var err error
		var foundPath string

		for _, basePath := range basePaths {
			fullPath := basePath + migration
			migrationSQL, err = os.ReadFile(fullPath)
			if err == nil {
				foundPath = fullPath
				break
			}
		}
		if err != nil {
			// Log warning but continue - might be deployed without migration files
			fmt.Printf("Warning: Migration file not found: %s (cwd: %s)\n", migration, cwd)
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
			fmt.Printf("Applied migration: %s (from %s)\n", migration, foundPath)
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
