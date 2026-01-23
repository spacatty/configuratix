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

	// Install script (public)
	installHandler := handlers.NewInstallHandler()
	router.HandleFunc("/install.sh", installHandler.ServeInstallScript).Methods("GET")

	// Setup routes (public - for initial setup only)
	setupHandler := handlers.NewSetupHandler(db)
	router.HandleFunc("/api/setup/status", setupHandler.CheckSetup).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/setup/create-admin", setupHandler.CreateFirstUser).Methods("POST", "OPTIONS")

	// Auth routes (public)
	authHandler := handlers.NewAuthHandler(db)
	router.HandleFunc("/api/auth/login", authHandler.Login).Methods("POST", "OPTIONS")
	router.HandleFunc("/api/auth/register", authHandler.Register).Methods("POST", "OPTIONS")

	// Agent enrollment (public - uses enrollment token)
	agentHandler := handlers.NewAgentHandler(db)
	router.HandleFunc("/api/agent/enroll", agentHandler.Enroll).Methods("POST", "OPTIONS")

	// Agent routes (requires agent API key)
	agentRouter := router.PathPrefix("/api/agent").Subrouter()
	agentRouter.Use(handlers.AgentAuthMiddleware(db))
	agentRouter.HandleFunc("/heartbeat", agentHandler.Heartbeat).Methods("POST", "OPTIONS")
	agentRouter.HandleFunc("/jobs", agentHandler.GetJobs).Methods("GET", "OPTIONS")
	agentRouter.HandleFunc("/jobs/update", agentHandler.UpdateJob).Methods("POST", "OPTIONS")

	// Protected API routes (requires user auth)
	apiRouter := router.PathPrefix("/api").Subrouter()
	apiRouter.Use(middleware.AuthMiddleware)

	// Auth (authenticated)
	apiRouter.HandleFunc("/auth/me", authHandler.Me).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/auth/password", authHandler.ChangePassword).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/auth/profile", authHandler.UpdateProfile).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/auth/2fa/setup", authHandler.Setup2FA).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/auth/2fa/enable", authHandler.Enable2FA).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/auth/2fa/disable", authHandler.Disable2FA).Methods("POST", "OPTIONS")

	// Admin routes
	adminHandler := handlers.NewAdminHandler(db)
	apiRouter.HandleFunc("/admin/stats", adminHandler.AdminStats).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/admin/users", adminHandler.ListUsers).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/admin/users", adminHandler.CreateAdmin).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/admin/users/{id}", adminHandler.GetUser).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/admin/users/{id}/role", adminHandler.UpdateUserRole).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/admin/users/{id}/password", adminHandler.ChangeUserPassword).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/admin/users/{id}/2fa", adminHandler.Reset2FA).Methods("DELETE", "OPTIONS")
	apiRouter.HandleFunc("/admin/users/{id}", adminHandler.DeleteUser).Methods("DELETE", "OPTIONS")
	apiRouter.HandleFunc("/admin/machines/{id}/token", adminHandler.ResetMachineToken).Methods("DELETE", "OPTIONS")

	// Projects
	projectsHandler := handlers.NewProjectsHandler(db)
	apiRouter.HandleFunc("/projects", projectsHandler.ListProjects).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/projects", projectsHandler.CreateProject).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/projects/join", projectsHandler.RequestJoin).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/projects/{id}", projectsHandler.GetProject).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/projects/{id}", projectsHandler.UpdateProject).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/projects/{id}", projectsHandler.DeleteProject).Methods("DELETE", "OPTIONS")
	apiRouter.HandleFunc("/projects/{id}/sharing", projectsHandler.ToggleSharing).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/projects/{id}/members", projectsHandler.ListMembers).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/projects/{project_id}/members/{member_id}/approve", projectsHandler.ApproveMember).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/projects/{project_id}/members/{member_id}/deny", projectsHandler.DenyMember).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/projects/{project_id}/members/{member_id}", projectsHandler.UpdateMember).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/projects/{project_id}/members/{member_id}", projectsHandler.RemoveMember).Methods("DELETE", "OPTIONS")

	// Machines
	machinesHandler := handlers.NewMachinesHandler(db)
	apiRouter.HandleFunc("/machines", machinesHandler.ListMachines).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}", machinesHandler.GetMachine).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}", machinesHandler.UpdateMachine).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/notes", machinesHandler.UpdateMachineNotes).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}", machinesHandler.DeleteMachine).Methods("DELETE", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/access-token", machinesHandler.SetAccessToken).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/access-token/verify", machinesHandler.VerifyAccessToken).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/ssh-port", machinesHandler.ChangeSSHPort).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/root-password", machinesHandler.ChangeRootPassword).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/ufw", machinesHandler.ToggleUFW).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/ufw/rules", machinesHandler.AddUFWRule).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/ufw/rules", machinesHandler.RemoveUFWRule).Methods("DELETE", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/fail2ban", machinesHandler.ToggleFail2ban).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/logs", machinesHandler.GetMachineLogs).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/exec", machinesHandler.ExecTerminalCommand).Methods("POST", "OPTIONS")

	// Machine Configs (file editing)
	configsHandler := handlers.NewConfigsHandler(db)
	apiRouter.HandleFunc("/machines/{id}/configs", configsHandler.ListConfigs).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/configs/read", configsHandler.ReadConfig).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/configs/write", configsHandler.WriteConfig).Methods("POST", "OPTIONS")
	// Custom config categories
	apiRouter.HandleFunc("/machines/{id}/configs/categories", configsHandler.CreateConfigCategory).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/configs/categories/{categoryId}", configsHandler.DeleteConfigCategory).Methods("DELETE", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/configs/categories/{categoryId}/paths", configsHandler.AddConfigPath).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/configs/categories/{categoryId}/paths/{pathId}", configsHandler.RemoveConfigPath).Methods("DELETE", "OPTIONS")

	// PHP Runtimes
	phpHandler := handlers.NewPHPRuntimeHandler(db)
	apiRouter.HandleFunc("/machines/{id}/php", phpHandler.GetPHPRuntime).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/php", phpHandler.InstallPHPRuntime).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/php", phpHandler.UpdatePHPRuntime).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/php", phpHandler.RemovePHPRuntime).Methods("DELETE", "OPTIONS")
	apiRouter.HandleFunc("/machines/{id}/php/info", phpHandler.GetPHPRuntimeInfo).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/php/extensions", phpHandler.ListAvailableExtensions).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/php/templates", phpHandler.ListExtensionTemplates).Methods("GET", "OPTIONS")

	// Enrollment Tokens
	apiRouter.HandleFunc("/enrollment-tokens", machinesHandler.ListEnrollmentTokens).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/enrollment-tokens", machinesHandler.CreateEnrollmentToken).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/enrollment-tokens/{id}", machinesHandler.DeleteEnrollmentToken).Methods("DELETE", "OPTIONS")

	// Machine Groups
	machineGroupsHandler := handlers.NewMachineGroupsHandler(db)
	apiRouter.HandleFunc("/machine-groups", machineGroupsHandler.ListMachineGroups).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/machine-groups", machineGroupsHandler.CreateMachineGroup).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/machine-groups/reorder", machineGroupsHandler.ReorderMachineGroups).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/machine-groups/{id}", machineGroupsHandler.UpdateMachineGroup).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/machine-groups/{id}", machineGroupsHandler.DeleteMachineGroup).Methods("DELETE", "OPTIONS")
	apiRouter.HandleFunc("/machine-groups/{id}/members", machineGroupsHandler.GetGroupMembers).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/machine-groups/{id}/members", machineGroupsHandler.AddGroupMembers).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/machine-groups/{id}/members/reorder", machineGroupsHandler.ReorderGroupMembers).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/machine-groups/{id}/members/{machineId}", machineGroupsHandler.RemoveGroupMember).Methods("DELETE", "OPTIONS")
	apiRouter.HandleFunc("/machines/{machineId}/groups", machineGroupsHandler.GetMachineGroups).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/machines/{machineId}/groups", machineGroupsHandler.SetMachineGroups).Methods("PUT", "OPTIONS")

	// Domains
	domainsHandler := handlers.NewDomainsHandler(db)
	apiRouter.HandleFunc("/domains", domainsHandler.ListDomains).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/domains", domainsHandler.CreateDomain).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/domains/{id}", domainsHandler.GetDomain).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/domains/{id}/assign", domainsHandler.AssignDomain).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/domains/{id}/notes", domainsHandler.UpdateDomainNotes).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/domains/{id}", domainsHandler.DeleteDomain).Methods("DELETE", "OPTIONS")

	// DNS Management (completely separate module from main domains)
	dnsHandler := handlers.NewDNSHandler(db)
	// DNS Accounts
	apiRouter.HandleFunc("/dns-accounts", dnsHandler.ListDNSAccounts).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/dns-accounts", dnsHandler.CreateDNSAccount).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/dns-accounts/{id}", dnsHandler.UpdateDNSAccount).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/dns-accounts/{id}", dnsHandler.DeleteDNSAccount).Methods("DELETE", "OPTIONS")
	apiRouter.HandleFunc("/dns-accounts/{id}/test", dnsHandler.TestDNSAccount).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/dns-accounts/{id}/nameservers", dnsHandler.GetExpectedNameservers).Methods("GET", "OPTIONS")
	// DNS Managed Domains (separate from main domains table)
	apiRouter.HandleFunc("/dns-domains", dnsHandler.ListDNSManagedDomains).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/dns-domains", dnsHandler.CreateDNSManagedDomain).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/dns-domains/{id}", dnsHandler.UpdateDNSManagedDomain).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/dns-domains/{id}", dnsHandler.DeleteDNSManagedDomain).Methods("DELETE", "OPTIONS")
	apiRouter.HandleFunc("/dns-domains/{id}/ns-check", dnsHandler.CheckDomainNS).Methods("POST", "OPTIONS")
	// DNS Records
	apiRouter.HandleFunc("/dns-domains/{id}/records", dnsHandler.ListDNSRecords).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/dns-domains/{id}/records", dnsHandler.CreateDNSRecord).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/dns-domains/{id}/records/{recordId}", dnsHandler.UpdateDNSRecord).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/dns-domains/{id}/records/{recordId}", dnsHandler.DeleteDNSRecord).Methods("DELETE", "OPTIONS")
	// DNS Sync
	apiRouter.HandleFunc("/dns-domains/{id}/sync", dnsHandler.CompareDNSRecords).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/dns-domains/{id}/sync/apply", dnsHandler.ApplyDNSToRemote).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/dns-domains/{id}/sync/import", dnsHandler.ImportDNSFromRemote).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/dns-domains/{id}/lookup", dnsHandler.LookupDNS).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/dns-domains/{id}/remote-records", dnsHandler.ListRemoteRecords).Methods("GET", "OPTIONS")

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

	// Commands (templates)
	commandsHandler := handlers.NewCommandsHandler(db)
	apiRouter.HandleFunc("/commands", commandsHandler.ListCommands).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/commands/{id}", commandsHandler.GetCommand).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/commands/execute", commandsHandler.ExecuteCommand).Methods("POST", "OPTIONS")

	// Static Content (formerly Landings)
	staticHandler := handlers.NewLandingsHandler(db)
	apiRouter.HandleFunc("/static", staticHandler.ListLandings).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/static", staticHandler.UploadLanding).Methods("POST", "OPTIONS")
	apiRouter.HandleFunc("/static/{id}", staticHandler.GetLanding).Methods("GET", "OPTIONS")
	apiRouter.HandleFunc("/static/{id}", staticHandler.UpdateLanding).Methods("PUT", "OPTIONS")
	apiRouter.HandleFunc("/static/{id}", staticHandler.DeleteLanding).Methods("DELETE", "OPTIONS")
	apiRouter.HandleFunc("/static/{id}/download", staticHandler.DownloadLanding).Methods("GET", "OPTIONS")
	// Static preview (public with token)
	router.PathPrefix("/api/static/preview/").HandlerFunc(staticHandler.ServePreview)

	// Terminal WebSocket
	terminalHandler := handlers.NewTerminalHandler(db)
	apiRouter.HandleFunc("/machines/{id}/terminal", terminalHandler.UserTerminalConnect).Methods("GET")
	apiRouter.HandleFunc("/machines/{id}/terminal/status", terminalHandler.GetTerminalStatus).Methods("GET", "OPTIONS")
	// Agent terminal WebSocket (uses agent auth)
	agentRouter.HandleFunc("/terminal", terminalHandler.AgentTerminalConnect).Methods("GET")
	// Agent static content download (uses agent auth)
	agentRouter.HandleFunc("/static/{id}/download", staticHandler.AgentDownloadLanding).Methods("GET", "OPTIONS")

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
