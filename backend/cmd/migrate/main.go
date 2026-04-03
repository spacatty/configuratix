package main

import (
	"log"
	"os"

	"configuratix/backend/internal/database"

	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()
	_ = godotenv.Load("../.env")

	db, err := database.New()
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer db.Close()

	if err := db.RunMigrations(); err != nil {
		log.Fatalf("migrations: %v", err)
	}
	log.Println("Migrations finished successfully.")
	os.Exit(0)
}
