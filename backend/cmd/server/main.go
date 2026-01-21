package main

import (
	"log"
	"net/http"
	"os"
	"strconv"

	"configuratix/backend/internal/database"
	"configuratix/backend/internal/handlers"
	"configuratix/backend/internal/middleware"
	"configuratix/backend/internal/scheduler"

	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
)

func main() {
	// Load .env file if it exists (ignore errors)
	_ = godotenv.Load()
	_ = godotenv.Load("../.env")

	db, err := database.New()
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Run migrations
	if err := db.RunMigrations(); err != nil {
		log.Printf("Warning: failed to run migrations: %v", err)
	}

	router := mux.NewRouter()
	router.Use(middleware.CORSMiddleware)

	// Setup routes (public - for initial setup only)
	setupHandler := handlers.NewSetupHandler(db)
	router.HandleFunc("/api/setup/status", setupHandler.CheckSetup).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/setup/create-admin", setupHandler.CreateFirstUser).Methods("POST", "OPTIONS")

	// Auth routes (public)
	authHandler := handlers.NewAuthHandler(db)
	router.HandleFunc("/api/auth/login", authHandler.Login).Methods("POST", "OPTIONS")
	router.Handle("/api/auth/me", middleware.AuthMiddleware(http.HandlerFunc(authHandler.Me))).Methods("GET", "OPTIONS")

	// Agent enrollment (public - uses enrollment token)
	agentHandler := handlers.NewAgentHandler(db)
	router.HandleFunc("/api/agent/enroll", agentHandler.Enroll).Methods("POST", "OPTIONS")

	// Agent routes (requires agent API key)
	agentRouter := router.PathPrefix("/api/agent").Subrouter()
	agentRouter.Use(handlers.AgentAuthMiddleware(db))
	agentRouter.HandleFunc("/heartbeat", agentHandler.Heartbeat).Methods("POST", "OPTIONS")
	agentRouter.HandleFunc("/jobs", agentHandler.GetJobs).Methods("GET", "OPTIONS")
	agentRouter.HandleFunc("/jobs/update", agentHandler.UpdateJob).Methods("POST", "OPTIONS")

	// Protected API routes
	apiRouter := router.PathPrefix("/api").Subrouter()
	apiRouter.Use(middleware.AuthMiddleware)

	// Machines
	machinesHandler := handlers.NewMachinesHandler(db)
	apiRouter.HandleFunc("/machines", machinesHandler.ListMachines).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}", machinesHandler.GetMachine).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/notes", machinesHandler.UpdateMachineNotes).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}", machinesHandler.DeleteMachine).Methods("DELETE", "OPTIONS")
	apiRouter.HandleFunc("/enrollment-tokens", machinesHandler.ListEnrollmentTokens).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/enrollment-tokens", machinesHandler.CreateEnrollmentToken).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/enrollment-tokens/{id}", machinesHandler.DeleteEnrollmentToken).Methods("DELETE", "OPTIONS")

	// Domains
	domainsHandler := handlers.NewDomainsHandler(db)
	apiRouter.HandleFunc("/domains", domainsHandler.ListDomains).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/domains", domainsHandler.CreateDomain).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/domains/{id}", domainsHandler.GetDomain).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/domains/{id}/assign", domainsHandler.AssignDomain).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/domains/{id}/notes", domainsHandler.UpdateDomainNotes).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/domains/{id}", domainsHandler.DeleteDomain).Methods("DELETE", "OPTIONS")

	// Nginx Configs
	nginxConfigsHandler := handlers.NewNginxConfigsHandler(db)
	apiRouter.HandleFunc("/nginx-configs", nginxConfigsHandler.ListNginxConfigs).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/nginx-configs", nginxConfigsHandler.CreateNginxConfig).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/nginx-configs/{id}", nginxConfigsHandler.GetNginxConfig).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/nginx-configs/{id}", nginxConfigsHandler.UpdateNginxConfig).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/nginx-configs/{id}", nginxConfigsHandler.DeleteNginxConfig).Methods("DELETE", "OPTIONS")

	// Jobs
	jobsHandler := handlers.NewJobsHandler(db)
	apiRouter.HandleFunc("/jobs", jobsHandler.ListJobs).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/jobs", jobsHandler.CreateJob).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/jobs/{id}", jobsHandler.GetJob).Methods("GET", "OPTIONS")

	// Start domain health check scheduler
	checkInterval := 1 // Default: 1 hour
	if intervalStr := os.Getenv("CHECK_INTERVAL_HOURS"); intervalStr != "" {
		if val, err := strconv.Atoi(intervalStr); err == nil && val > 0 {
			checkInterval = val
		}
	}
	sched := scheduler.New(db, checkInterval)
	sched.Start()
	defer sched.Stop()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s", port)
	log.Printf("Domain health check interval: %d hour(s)", checkInterval)
	if err := http.ListenAndServe(":"+port, router); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
