package main

import (
	"fmt"
	"os"

	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
	"github.com/jmoiron/sqlx"
)

func main() {
	// Load .env file if it exists
	_ = godotenv.Load()
	_ = godotenv.Load("../.env")

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://postgres:postgres@localhost:5432/configuratix?sslmode=disable"
	}

	fmt.Printf("Checking database connection...\n")

	db, err := sqlx.Connect("postgres", dsn)
	if err != nil {
		fmt.Printf("ERROR: Failed to connect to database: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		fmt.Printf("ERROR: Failed to ping database: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("SUCCESS: Database connection OK\n")
}

