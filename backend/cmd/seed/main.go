// Command seed fills a development database with realistic demo data (machines, agents,
// domains, groups, configs, jobs, DNS zones, IP bans) so the UI can be previewed without
// real servers. Every row gets a deterministic UUID, so running it again replaces the
// previous seed and -clean removes it without touching real data.
//
//	go run ./cmd/seed                # (re)seed for the first superadmin
//	go run ./cmd/seed -keepalive     # also keep "online" machines online and restore domain health
//	go run ./cmd/seed -clean         # remove seeded rows only
//
// Seeded domains use the reserved .test TLD and machines use documentation IP ranges, so the
// backend's health checker never reaches a real host (it marks assigned domains unhealthy on
// its next run; -keepalive puts the seeded health back).
package main

import (
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/joho/godotenv"
	"github.com/lib/pq"
)

var ns = uuid.MustParse("6f1d2c1e-5d0b-4c39-9a51-7e2f0c9b5e11")

func id(kind, key string) uuid.UUID { return uuid.NewSHA1(ns, []byte(kind+":"+key)) }

const gb = int64(1 << 30)

type machineSeed struct {
	host, title, ip, os, version, arch, project, notes string
	state                                              string // online | offline | never | updating | update_failed
	seenAgo                                            time.Duration
	cpu                                                float64
	memGB, memUsed, diskGB, diskUsed                   float64
	php                                                string
	ufw, f2b                                           bool
	sshPort                                            int
	extraIPs                                           []string
	groups                                             []string
}

var machines = []machineSeed{
	{host: "edge-fra-01", title: "Edge · Frankfurt 1", ip: "203.0.113.10", os: "Ubuntu 24.04.1 LTS", version: "0.6.0", state: "online", cpu: 23, memGB: 8, memUsed: 3.1, diskGB: 160, diskUsed: 41, ufw: true, f2b: true, project: "Storefront", groups: []string{"Production", "Edge"}, extraIPs: []string{"2001:db8:10::1"}},
	{host: "edge-fra-02", title: "Edge · Frankfurt 2", ip: "203.0.113.11", os: "Ubuntu 24.04.1 LTS", version: "0.6.0", state: "online", cpu: 31, memGB: 8, memUsed: 3.9, diskGB: 160, diskUsed: 44, ufw: true, f2b: true, project: "Storefront", groups: []string{"Production", "Edge"}},
	{host: "edge-ams-01", title: "Edge · Amsterdam", ip: "203.0.113.20", os: "Ubuntu 24.04.1 LTS", version: "0.6.0", state: "online", cpu: 78, memGB: 4, memUsed: 3.2, diskGB: 80, diskUsed: 52, ufw: true, f2b: true, project: "Storefront", groups: []string{"Production", "Edge"}},
	{host: "edge-waw-01", title: "", ip: "203.0.113.30", os: "Ubuntu 22.04.4 LTS", version: "0.5.3", state: "online", cpu: 12, memGB: 4, memUsed: 1.4, diskGB: 80, diskUsed: 19, ufw: true, groups: []string{"Edge"}},
	{host: "web-nyc-01", title: "Web · New York", ip: "198.51.100.40", os: "Ubuntu 24.04.1 LTS", version: "0.6.0", state: "online", cpu: 94, memGB: 16, memUsed: 15.1, diskGB: 320, diskUsed: 188, php: "8.3", ufw: true, f2b: true, project: "Example", groups: []string{"Production"}, notes: "## Web NYC\n\nMain PHP host for client sites.\n\n- php-fpm pool tuned to 48 children\n- nightly backup to `backup-01`"},
	{host: "web-nyc-02", title: "Web · New York 2", ip: "198.51.100.41", os: "Ubuntu 24.04.1 LTS", version: "0.6.0", state: "updating", cpu: 41, memGB: 16, memUsed: 9.8, diskGB: 320, diskUsed: 301, php: "8.3", ufw: true, f2b: true, project: "Example", groups: []string{"Production"}},
	{host: "db-primary-01", title: "Postgres primary", ip: "198.51.100.50", os: "Ubuntu 22.04.4 LTS", version: "0.6.0", state: "online", cpu: 55, memGB: 64, memUsed: 51, diskGB: 1000, diskUsed: 712, ufw: true, f2b: true, sshPort: 2222, project: "Internal tools", groups: []string{"Production", "Databases"}},
	{host: "db-replica-01", title: "Postgres replica", ip: "198.51.100.51", os: "Ubuntu 22.04.4 LTS", version: "0.6.0", state: "offline", seenAgo: 3 * time.Hour, cpu: 8, memGB: 64, memUsed: 22, diskGB: 1000, diskUsed: 698, ufw: true, sshPort: 2222, project: "Internal tools", groups: []string{"Databases"}},
	{host: "worker-sgp-03", title: "", ip: "192.0.2.73", os: "Debian GNU/Linux 12 (bookworm)", version: "0.6.0", arch: "arm64", state: "online", cpu: 67, memGB: 8, memUsed: 6.9, diskGB: 120, diskUsed: 64, groups: []string{"Production"}},
	{host: "staging-01", title: "Staging", ip: "192.0.2.10", os: "Ubuntu 24.04.1 LTS", version: "0.6.0", state: "online", cpu: 5, memGB: 4, memUsed: 1.1, diskGB: 80, diskUsed: 23, php: "8.2", project: "Storefront", groups: []string{"Staging"}},
	{host: "staging-02", title: "Staging (PR previews)", ip: "192.0.2.11", os: "Ubuntu 24.04.1 LTS", version: "0.5.3", state: "update_failed", cpu: 18, memGB: 4, memUsed: 2.3, diskGB: 80, diskUsed: 71, project: "Storefront", groups: []string{"Staging"}},
	{host: "legacy-php-01", title: "Legacy PHP 7.4 box", ip: "192.0.2.90", os: "Ubuntu 20.04.6 LTS", version: "0.4.1", state: "offline", seenAgo: 9 * 24 * time.Hour, cpu: 0, memGB: 2, memUsed: 1.7, diskGB: 40, diskUsed: 38, php: "7.4", groups: []string{"Legacy"}, notes: "Scheduled for decommission once the last two client sites move to `web-nyc-02`."},
	{host: "mail-relay-01", title: "", ip: "192.0.2.120", os: "Ubuntu 22.04.4 LTS", version: "0.6.0", state: "offline", seenAgo: 25 * time.Minute, cpu: 3, memGB: 2, memUsed: 0.6, diskGB: 40, diskUsed: 9, ufw: true, f2b: true, project: "Internal tools"},
	{host: "builder-01", title: "CI builder", ip: "192.0.2.130", os: "Ubuntu 24.04.1 LTS", version: "0.6.0", state: "never", project: "Internal tools"},
	{host: "sandbox-eu-central-experimental-node-0001", title: "", ip: "192.0.2.200", os: "Ubuntu 24.04.1 LTS", version: "0.6.0", state: "online", cpu: 2, memGB: 1, memUsed: 0.4, diskGB: 25, diskUsed: 6, groups: []string{"Staging", "Edge", "Legacy"}, extraIPs: []string{"10.0.0.5", "2001:db8:200::5"}},
}

type groupSeed struct{ name, emoji, color string }

var machineGroups = []groupSeed{
	{"Production", "🚀", "#22c55e"},
	{"Staging", "🧪", "#f59e0b"},
	{"Edge", "🌍", "#3b82f6"},
	{"Databases", "🗄️", "#a855f7"},
	{"Legacy", "🧓", "#64748b"},
}

var domainGroups = []groupSeed{
	{"Storefront", "🛒", "#22c55e"},
	{"Client sites", "👥", "#3b82f6"},
	{"Marketing landings", "📣", "#ec4899"},
	{"APIs", "🔌", "#a855f7"},
	{"Redirects", "↪️", "#f59e0b"},
	{"Parked", "💤", "#64748b"},
}

var projects = []string{"Storefront", "Internal tools"}

type configSeed struct {
	name string
	cfg  map[string]any
}

var configs = []configSeed{
	{"Reverse proxy → app:3000", map[string]any{"ssl_mode": "redirect_https", "locations": []map[string]any{{"path": "/", "type": "proxy", "proxy_url": "http://127.0.0.1:3000"}}}},
	{"Static landing", map[string]any{"ssl_mode": "redirect_https", "locations": []map[string]any{{"path": "/", "type": "static", "static_type": "local", "root": "/var/www/landing", "index": "index.html"}}}},
	{"PHP-FPM site", map[string]any{"ssl_mode": "redirect_https", "locations": []map[string]any{{"path": "/", "type": "static", "static_type": "local", "root": "/var/www/site/public", "index": "index.php", "use_php": true}}}},
	{"API gateway (CORS)", map[string]any{"ssl_mode": "redirect_https", "cors": map[string]any{"enabled": true, "allow_all": true}, "locations": []map[string]any{{"path": "/", "type": "proxy", "proxy_url": "http://127.0.0.1:8080"}}}},
	{"Plain HTTP (no TLS)", map[string]any{"ssl_mode": "disabled", "locations": []map[string]any{{"path": "/", "type": "proxy", "proxy_url": "http://127.0.0.1:8000"}}}},
}

// domainSeed health: healthy | unhealthy | down | proxied | idle; apply: applied | out_of_sync | applying | pending | failed | removing | "" (none)
type domainSeed struct {
	fqdn, machine, config, health, apply, path string
	expect                                     int
	groups                                     []string
	notes                                      string
}

var domains = []domainSeed{
	{fqdn: "shop.aurora-goods.test", machine: "edge-fra-01", config: "Reverse proxy → app:3000", health: "healthy", apply: "applied", groups: []string{"Storefront"}},
	{fqdn: "www.aurora-goods.test", machine: "edge-fra-01", config: "Reverse proxy → app:3000", health: "healthy", apply: "applied", groups: []string{"Storefront"}},
	{fqdn: "aurora-goods.test", machine: "edge-fra-02", config: "Reverse proxy → app:3000", health: "healthy", apply: "applied", groups: []string{"Storefront", "Redirects"}},
	{fqdn: "checkout.aurora-goods.test", machine: "edge-fra-02", config: "Reverse proxy → app:3000", health: "healthy", apply: "out_of_sync", path: "/healthz", groups: []string{"Storefront"}},
	{fqdn: "cdn.aurora-goods.test", machine: "edge-ams-01", config: "Static landing", health: "healthy", apply: "applied", groups: []string{"Storefront"}},
	{fqdn: "img.aurora-goods.test", machine: "edge-ams-01", config: "Static landing", health: "proxied", apply: "applied", groups: []string{"Storefront"}},
	{fqdn: "status.aurora-goods.test", machine: "edge-waw-01", config: "Static landing", health: "healthy", apply: "applying", groups: []string{"Storefront"}},
	{fqdn: "api.aurora-goods.test", machine: "edge-fra-01", config: "API gateway (CORS)", health: "healthy", apply: "applied", path: "/v1/health", groups: []string{"Storefront", "APIs"}},
	{fqdn: "api-v2.aurora-goods.test", machine: "edge-fra-02", config: "API gateway (CORS)", health: "unhealthy", apply: "failed", path: "/v2/health", groups: []string{"APIs"}},
	{fqdn: "graphql.aurora-goods.test", machine: "edge-ams-01", config: "API gateway (CORS)", health: "healthy", apply: "pending", groups: []string{"APIs"}},
	{fqdn: "staging.aurora-goods.test", machine: "staging-01", config: "Reverse proxy → app:3000", health: "healthy", apply: "applied", expect: 401, groups: []string{"Storefront"}, notes: "Behind basic auth — expects **401**."},
	{fqdn: "pr-1842.preview.aurora-goods.test", machine: "staging-02", config: "Reverse proxy → app:3000", health: "down", apply: "failed"},
	{fqdn: "pr-1857.preview.aurora-goods.test", machine: "staging-02", config: "Reverse proxy → app:3000", health: "healthy", apply: "applied"},
	{fqdn: "pr-1861.preview.aurora-goods.test", machine: "staging-02", config: "Reverse proxy → app:3000", health: "", apply: "applying"},

	{fqdn: "bellweather-bakery.test", machine: "web-nyc-01", config: "PHP-FPM site", health: "healthy", apply: "applied", groups: []string{"Client sites"}},
	{fqdn: "www.bellweather-bakery.test", machine: "web-nyc-01", config: "PHP-FPM site", health: "healthy", apply: "applied", groups: []string{"Client sites", "Redirects"}},
	{fqdn: "harbor-dental.test", machine: "web-nyc-01", config: "PHP-FPM site", health: "healthy", apply: "applied", groups: []string{"Client sites"}, notes: "Client contact: front desk. Renewal due in March."},
	{fqdn: "harborlight-yoga-and-wellness-studio-downtown.test", machine: "web-nyc-01", config: "PHP-FPM site", health: "healthy", apply: "out_of_sync", groups: []string{"Client sites"}},
	{fqdn: "kettle-and-crumb.test", machine: "web-nyc-02", config: "PHP-FPM site", health: "unhealthy", apply: "applied", groups: []string{"Client sites"}},
	{fqdn: "northwind-law.test", machine: "web-nyc-02", config: "PHP-FPM site", health: "healthy", apply: "applied", groups: []string{"Client sites"}},
	{fqdn: "www.northwind-law.test", machine: "web-nyc-02", config: "PHP-FPM site", health: "healthy", apply: "removing", groups: []string{"Client sites"}},
	{fqdn: "oakridge-vet.test", machine: "legacy-php-01", config: "PHP-FPM site", health: "down", apply: "applied", groups: []string{"Client sites"}, notes: "Machine offline — migrate to web-nyc-02."},
	{fqdn: "pinecrest-realty.test", machine: "legacy-php-01", config: "PHP-FPM site", health: "down", apply: "applied", groups: []string{"Client sites"}},
	{fqdn: "quill-and-ink.test", machine: "web-nyc-01", config: "PHP-FPM site", health: "healthy", apply: "applied", groups: []string{"Client sites"}},
	{fqdn: "riverside-auto.test", machine: "web-nyc-02", config: "PHP-FPM site", health: "healthy", apply: "", groups: []string{"Client sites"}},

	{fqdn: "go.spring-promo.test", machine: "edge-ams-01", config: "Static landing", health: "healthy", apply: "applied", groups: []string{"Marketing landings"}},
	{fqdn: "black-friday.spring-promo.test", machine: "edge-ams-01", config: "Static landing", health: "healthy", apply: "applied", groups: []string{"Marketing landings"}},
	{fqdn: "webinar.spring-promo.test", machine: "edge-waw-01", config: "Static landing", health: "proxied", apply: "applied", groups: []string{"Marketing landings"}},
	{fqdn: "ebook.spring-promo.test", machine: "edge-waw-01", config: "Static landing", health: "healthy", apply: "out_of_sync", groups: []string{"Marketing landings"}},
	{fqdn: "early-access.spring-promo.test", machine: "sandbox-eu-central-experimental-node-0001", config: "Static landing", health: "unhealthy", apply: "applied", expect: 200, groups: []string{"Marketing landings"}},
	{fqdn: "lp1.spring-promo.test", machine: "edge-fra-01", config: "Static landing", health: "healthy", apply: "applied", groups: []string{"Marketing landings"}},
	{fqdn: "lp2.spring-promo.test", machine: "edge-fra-01", config: "Static landing", health: "healthy", apply: "applied", groups: []string{"Marketing landings"}},
	{fqdn: "lp3.spring-promo.test", machine: "edge-fra-02", config: "Static landing", health: "healthy", apply: "pending", groups: []string{"Marketing landings"}},

	{fqdn: "internal.northpeak.test", machine: "db-primary-01", config: "Plain HTTP (no TLS)", health: "healthy", apply: "applied", groups: []string{"APIs"}},
	{fqdn: "grafana.northpeak.test", machine: "worker-sgp-03", config: "Reverse proxy → app:3000", health: "healthy", apply: "applied", expect: 302},
	{fqdn: "metrics.northpeak.test", machine: "worker-sgp-03", config: "Reverse proxy → app:3000", health: "unhealthy", apply: "applied", path: "/-/ready"},
	{fqdn: "webhooks.northpeak.test", machine: "worker-sgp-03", config: "API gateway (CORS)", health: "healthy", apply: "applied", groups: []string{"APIs"}},
	{fqdn: "smtp.northpeak.test", machine: "mail-relay-01", config: "", health: "down", apply: ""},
	{fqdn: "ci.northpeak.test", machine: "builder-01", config: "Reverse proxy → app:3000", health: "", apply: "pending"},

	{fqdn: "old-brand.test", machine: "", config: "", health: "idle", groups: []string{"Parked", "Redirects"}},
	{fqdn: "www.old-brand.test", machine: "", config: "", health: "idle", groups: []string{"Parked"}},
	{fqdn: "aurora-goods-shop.test", machine: "", config: "", health: "idle", groups: []string{"Parked"}},
	{fqdn: "auroragoods.test", machine: "", config: "", health: "idle", groups: []string{"Parked"}},
	{fqdn: "spring-promo-2025.test", machine: "", config: "", health: "idle"},
	{fqdn: "maybe-later.test", machine: "", config: "", health: "idle", notes: "Bought for the Q3 campaign, not used yet."},
	{fqdn: "very-long-subdomain-name-for-testing-layouts.with.many.levels.example-holdings.test", machine: "", config: "", health: "idle"},
}

type dnsSeed struct {
	fqdn, provider, ns string
	records            [][4]string // name, type, value, sync status
}

var dnsZones = []dnsSeed{
	{"aurora-goods.test", "cloudflare", "valid", [][4]string{{"@", "A", "203.0.113.11", "synced"}, {"www", "A", "203.0.113.10", "synced"}, {"shop", "A", "203.0.113.10", "synced"}, {"api", "A", "203.0.113.10", "synced"}, {"cdn", "CNAME", "edge-ams-01.aurora-goods.test", "synced"}, {"@", "MX", "mail.aurora-goods.test", "synced"}, {"@", "TXT", "v=spf1 include:_spf.aurora-goods.test ~all", "pending"}, {"staging", "A", "192.0.2.10", "conflict"}}},
	{"spring-promo.test", "desec", "valid", [][4]string{{"go", "A", "203.0.113.20", "synced"}, {"lp1", "A", "203.0.113.10", "synced"}, {"lp2", "A", "203.0.113.10", "synced"}, {"lp3", "A", "203.0.113.11", "local_only"}, {"*", "A", "203.0.113.20", "synced"}}},
	{"northpeak.test", "cloudflare", "pending", [][4]string{{"grafana", "A", "192.0.2.73", "synced"}, {"metrics", "A", "192.0.2.73", "error"}, {"smtp", "A", "192.0.2.120", "remote_only"}}},
	{"old-brand.test", "njalla", "invalid", [][4]string{{"@", "A", "192.0.2.90", "pending"}}},
	{"bellweather-bakery.test", "", "unknown", nil},
}

var bans = [][3]string{
	{"185.220.101.4", "bad_user_agent", "edge-fra-01"},
	{"185.220.101.17", "bad_user_agent", "edge-fra-01"},
	{"45.155.205.233", "endpoint_scan", "edge-fra-02"},
	{"89.248.165.52", "endpoint_scan", "edge-ams-01"},
	{"141.98.11.11", "ssh_bruteforce", "web-nyc-01"},
	{"141.98.11.40", "ssh_bruteforce", "web-nyc-01"},
	{"193.32.162.68", "ssh_bruteforce", "db-primary-01"},
	{"80.82.77.139", "endpoint_scan", "edge-waw-01"},
	{"162.142.125.9", "manual", ""},
	{"2a06:4880::3", "bad_user_agent", "edge-fra-01"},
	{"64.62.197.88", "endpoint_scan", "worker-sgp-03"},
	{"92.118.39.73", "ssh_bruteforce", "staging-02"},
}

func main() {
	clean := flag.Bool("clean", false, "remove seeded rows and exit")
	keepalive := flag.Bool("keepalive", false, "after seeding, keep online machines online and restore seeded domain health every 30s")
	ownerEmail := flag.String("owner", "", "email of the user that owns seeded data (default: first superadmin)")
	flag.Parse()

	_ = godotenv.Load()
	_ = godotenv.Load("../.env")
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is not set")
	}
	db := sqlx.MustConnect("postgres", dsn)
	defer db.Close()

	var owner uuid.UUID
	var err error
	if *ownerEmail != "" {
		err = db.Get(&owner, `SELECT id FROM users WHERE email = $1`, *ownerEmail)
	} else {
		err = db.Get(&owner, `SELECT id FROM users ORDER BY (role = 'superadmin') DESC, created_at LIMIT 1`)
	}
	if err != nil {
		log.Fatalf("owner lookup: %v", err)
	}

	tx := db.MustBegin()
	removeSeed(tx)
	if *clean {
		must(tx.Commit())
		fmt.Println("Seed data removed.")
		return
	}
	insertSeed(tx, owner)
	must(tx.Commit())
	fmt.Printf("Seeded %d machines, %d domains, %d DNS zones, %d IP bans for %s.\n", len(machines), len(domains), len(dnsZones), len(bans), owner)

	if *keepalive {
		runKeepalive(db)
	}
}

// removeSeed deletes every row whose id the seed generates (children cascade).
func removeSeed(tx *sqlx.Tx) {
	var agents, machineIDs, domainIDs, configIDs, groupIDs, dgroupIDs, projectIDs, zoneIDs, accountIDs []uuid.UUID
	for _, m := range machines {
		agents = append(agents, id("agent", m.host))
		machineIDs = append(machineIDs, id("machine", m.host))
	}
	for _, d := range domains {
		domainIDs = append(domainIDs, id("domain", d.fqdn))
	}
	for _, c := range configs {
		configIDs = append(configIDs, id("config", c.name))
	}
	for _, g := range machineGroups {
		groupIDs = append(groupIDs, id("mgroup", g.name))
	}
	for _, g := range domainGroups {
		dgroupIDs = append(dgroupIDs, id("dgroup", g.name))
	}
	for _, p := range projects {
		projectIDs = append(projectIDs, id("project", p))
	}
	for _, z := range dnsZones {
		zoneIDs = append(zoneIDs, id("zone", z.fqdn))
		accountIDs = append(accountIDs, id("dnsaccount", z.provider))
	}
	for _, q := range []struct {
		sql string
		ids []uuid.UUID
	}{
		{`DELETE FROM jobs WHERE agent_id = ANY($1)`, agents},
		{`DELETE FROM domains WHERE id = ANY($1)`, domainIDs},
		{`DELETE FROM nginx_configs WHERE id = ANY($1)`, configIDs},
		{`DELETE FROM machine_groups WHERE id = ANY($1)`, groupIDs},
		{`DELETE FROM domain_groups WHERE id = ANY($1)`, dgroupIDs},
		{`DELETE FROM dns_managed_domains WHERE id = ANY($1)`, zoneIDs},
		{`DELETE FROM dns_accounts WHERE id = ANY($1)`, accountIDs},
		{`DELETE FROM machines WHERE id = ANY($1)`, machineIDs},
		{`DELETE FROM agents WHERE id = ANY($1)`, agents},
		{`DELETE FROM projects WHERE id = ANY($1)`, projectIDs},
	} {
		tx.MustExec(q.sql, pq.Array(q.ids))
	}
	tx.MustExec(`DELETE FROM security_ip_bans WHERE details->>'seed' = 'true'`)
}

func insertSeed(tx *sqlx.Tx, owner uuid.UUID) {
	rng := rand.New(rand.NewSource(42))
	now := time.Now()

	projectID := map[string]uuid.UUID{}
	var existing uuid.UUID
	if err := tx.Get(&existing, `SELECT id FROM projects WHERE name = 'Example' AND owner_id = $1 LIMIT 1`, owner); err == nil {
		projectID["Example"] = existing
	}
	for _, p := range projects {
		pid := id("project", p)
		projectID[p] = pid
		tx.MustExec(`INSERT INTO projects (id, name, owner_id, notes_md) VALUES ($1, $2, $3, $4)`, pid, p, owner, "Seeded demo project.")
	}

	groupID := map[string]uuid.UUID{}
	for i, g := range machineGroups {
		gid := id("mgroup", g.name)
		groupID[g.name] = gid
		tx.MustExec(`INSERT INTO machine_groups (id, owner_id, name, emoji, color, position) VALUES ($1, $2, $3, $4, $5, $6)`, gid, owner, g.name, g.emoji, g.color, i)
	}

	machineID := map[string]uuid.UUID{}
	agentID := map[string]uuid.UUID{}
	for i, m := range machines {
		aid, mid := id("agent", m.host), id("machine", m.host)
		agentID[m.host], machineID[m.host] = aid, mid

		var lastSeen any
		switch m.state {
		case "never":
		case "offline":
			lastSeen = now.Add(-m.seenAgo)
		default:
			lastSeen = now.Add(-time.Duration(rng.Intn(20)) * time.Second)
		}
		arch := m.arch
		if arch == "" {
			arch = "amd64"
		}
		var caps any
		if m.version == "0.6.0" {
			caps = `["run.v2","steps.if","steps.capture","file.atomic","logs.stream","job.cancel","job.timeout","result.structured","update.v2","terminal.persistent"]`
		}
		var updState, updTarget, updErr any
		var updStarted any
		switch m.state {
		case "updating":
			updState, updTarget, updStarted = "downloading", "0.6.1", now.Add(-40*time.Second)
		case "update_failed":
			updState, updTarget, updErr = "failed", "0.6.0", "checksum mismatch after download (expected 9f2c…, got 41ab…)"
		}
		tx.MustExec(`INSERT INTO agents (id, name, token_hash, version, last_seen, capabilities, arch, update_state, update_target_version, update_started_at, last_update_error, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
			aid, m.host, "seed:"+m.host, m.version, lastSeen, caps, arch, updState, updTarget, updStarted, updErr, now.Add(-time.Duration(30+i*11)*24*time.Hour))

		ips := []map[string]any{{"ip": m.ip, "interface": "eth0", "is_ipv6": false, "is_public": true}}
		for _, x := range m.extraIPs {
			v6, iface := strings.Contains(x, ":"), "eth0"
			if !v6 {
				iface = "eth1"
			}
			ips = append(ips, map[string]any{"ip": x, "interface": iface, "is_ipv6": v6, "is_public": !strings.HasPrefix(x, "10.")})
		}
		ipsJSON, _ := json.Marshal(ips)
		var title, notes, project, phpVer any
		if m.title != "" {
			title = m.title
		} else {
			title = m.host
		}
		if m.notes != "" {
			notes = m.notes
		}
		if m.project != "" {
			if pid, ok := projectID[m.project]; ok {
				project = pid
			}
		}
		if m.php != "" {
			phpVer = m.php
		}
		ssh := m.sshPort
		if ssh == 0 {
			ssh = 22
		}
		var cpu any = m.cpu
		if m.state == "never" {
			cpu = 0
		}
		tx.MustExec(`INSERT INTO machines (id, agent_id, hostname, title, ip_address, primary_ip, detected_ips, ubuntu_version, notes_md, owner_id, project_id,
				ssh_port, ufw_enabled, fail2ban_enabled, root_password_set, access_token_set, cpu_percent, memory_used, memory_total, disk_used, disk_total,
				php_installed, php_version, created_at)
			VALUES ($1,$2,$3,$4,$5::text,$5::text,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
			mid, aid, m.host, title, m.ip, string(ipsJSON), m.os, notes, owner, project,
			ssh, m.ufw, m.f2b, i%3 == 0, i%2 == 0, cpu, int64(m.memUsed*float64(gb)), int64(m.memGB*float64(gb)), int64(m.diskUsed*float64(gb)), int64(m.diskGB*float64(gb)),
			m.php != "", phpVer, now.Add(-time.Duration(30+i*11)*24*time.Hour))

		for pos, g := range m.groups {
			tx.MustExec(`INSERT INTO machine_group_members (id, group_id, machine_id, position) VALUES ($1, $2, $3, $4)`, id("mgm", m.host+"/"+g), groupID[g], mid, pos)
		}
	}

	configID := map[string]uuid.UUID{}
	for i, c := range configs {
		cid := id("config", c.name)
		configID[c.name] = cid
		js, _ := json.Marshal(c.cfg)
		tx.MustExec(`INSERT INTO nginx_configs (id, name, mode, structured_json, owner_id, created_at, updated_at) VALUES ($1, $2, 'auto', $3, $4, $5, $6)`,
			cid, c.name, string(js), owner, now.Add(-time.Duration(60-i)*24*time.Hour), now.Add(-time.Duration(2+i)*time.Hour))
	}

	dgroupID := map[string]uuid.UUID{}
	for i, g := range domainGroups {
		gid := id("dgroup", g.name)
		dgroupID[g.name] = gid
		tx.MustExec(`INSERT INTO domain_groups (id, owner_id, name, emoji, color, position) VALUES ($1, $2, $3, $4, $5, $6)`, gid, owner, g.name, g.emoji, g.color, i)
	}

	for i, d := range domains {
		did := id("domain", d.fqdn)
		created := now.Add(-time.Duration(5+i*3) * 24 * time.Hour)
		var assigned, agent any
		if d.machine != "" {
			assigned, agent = machineID[d.machine], agentID[d.machine]
		}
		status, code, ms, checkErr := healthFields(d, rng)
		var lastCheck any
		if d.machine != "" || status != "idle" {
			lastCheck = now.Add(-time.Duration(rng.Intn(50)+1) * time.Minute)
		}
		expect := d.expect
		if expect == 0 {
			expect = 200
		}
		var path, notes any
		if d.path != "" {
			path = d.path
		}
		if d.notes != "" {
			notes = d.notes
		}

		// Config updated ~2-6h ago; applied before that => out of sync, after => in sync.
		var applyStatus, applyErr, appliedAt any
		switch d.apply {
		case "applied":
			applyStatus, appliedAt = "applied", now.Add(-time.Duration(rng.Intn(60)+5)*time.Minute)
		case "out_of_sync":
			applyStatus, appliedAt = "applied", now.Add(-time.Duration(3+rng.Intn(10))*24*time.Hour)
		case "applying", "pending", "removing":
			applyStatus = d.apply
		case "failed":
			applyStatus, applyErr = "failed", "nginx: [emerg] host not found in upstream \"app:3000\" in /etc/nginx/sites-enabled/"+d.fqdn+".conf:14\nnginx: configuration file /etc/nginx/nginx.conf test failed"
		}
		tx.MustExec(`INSERT INTO domains (id, fqdn, assigned_machine_id, status, last_check_at, notes_md, owner_id, health_check_expected_status, health_check_path,
				last_check_status_code, last_check_response_ms, last_check_error, apply_status, last_apply_error, last_applied_at, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)`,
			did, d.fqdn, assigned, status, lastCheck, notes, owner, expect, path, code, ms, checkErr, applyStatus, applyErr, appliedAt, created)

		if d.config != "" {
			tx.MustExec(`INSERT INTO domain_config_links (id, domain_id, nginx_config_id) VALUES ($1, $2, $3)`, id("dcl", d.fqdn), did, configID[d.config])
		}
		for pos, g := range d.groups {
			tx.MustExec(`INSERT INTO domain_group_members (id, group_id, domain_id, position) VALUES ($1, $2, $3, $4)`, id("dgm", d.fqdn+"/"+g), dgroupID[g], did, pos)
		}

		if agent != nil && d.apply != "" {
			jobStatus := map[string]string{"applied": "completed", "out_of_sync": "completed", "applying": "running", "pending": "pending", "removing": "running", "failed": "failed"}[d.apply]
			action, title := "apply_domain", "Apply nginx config · "+d.fqdn
			if d.apply == "removing" {
				action, title = "remove_domain", "Remove nginx config · "+d.fqdn
			}
			jid := id("job", "domain/"+d.fqdn)
			insertJob(tx, jid, agent.(uuid.UUID), owner, title, action, "domain", did.String(), jobStatus, applyErr, now.Add(-time.Duration(rng.Intn(90)+2)*time.Minute))
			tx.MustExec(`UPDATE domains SET last_job_id = $1 WHERE id = $2`, jid, did)
		}
	}

	// Machine-level job history so the jobs page and machine activity look lived-in.
	machineJobs := []struct{ title, action, status, err string }{
		{"Read nginx configuration", "nginx_inventory", "completed", ""},
		{"Read logs · nginx_error", "read_logs", "completed", ""},
		{"Run command 'systemctl status nginx'", "exec_command", "completed", ""},
		{"Toggle UFW · enable", "toggle_ufw", "completed", ""},
		{"UFW allow 8443/tcp", "ufw_allow_port", "completed", ""},
		{"Run command 'apt-get -y upgrade'", "exec_command", "failed", "E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process 2231 (unattended-upgr)"},
		{"Change SSH port → 2222", "change_ssh_port", "completed", ""},
		{"Read file /etc/nginx/nginx.conf", "read_file", "completed", ""},
		{"Run command 'df -h'", "exec_command", "cancelled", ""},
		{"Update agent to 0.6.0", "update_agent", "completed", ""},
	}
	for _, m := range machines {
		if m.state == "never" {
			continue
		}
		n := 2 + rng.Intn(4)
		for k := 0; k < n; k++ {
			j := machineJobs[rng.Intn(len(machineJobs))]
			var errMsg any
			if j.err != "" {
				errMsg = j.err
			}
			at := now.Add(-time.Duration(rng.Intn(14*24*60)+30) * time.Minute)
			if m.state == "offline" && at.After(now.Add(-m.seenAgo)) {
				at = now.Add(-m.seenAgo - time.Duration(rng.Intn(600)+5)*time.Minute)
			}
			insertJob(tx, id("job", fmt.Sprintf("machine/%s/%d", m.host, k)), agentID[m.host], owner, j.title, j.action, "machine", machineID[m.host].String(), j.status, errMsg, at)
		}
	}

	accountID := map[string]uuid.UUID{}
	for _, z := range dnsZones {
		if z.provider == "" || accountID[z.provider] != uuid.Nil {
			continue
		}
		aid := id("dnsaccount", z.provider)
		accountID[z.provider] = aid
		name := map[string]string{"cloudflare": "Cloudflare (main)", "desec": "deSEC", "njalla": "Njalla"}[z.provider]
		tx.MustExec(`INSERT INTO dns_accounts (id, owner_id, provider, name, api_token, is_default) VALUES ($1, $2, $3, $4, 'seed-placeholder-not-a-real-token', $5)`,
			aid, owner, z.provider, name, z.provider == "cloudflare")
	}
	for _, z := range dnsZones {
		zid := id("zone", z.fqdn)
		var acct any
		if z.provider != "" {
			acct = accountID[z.provider]
		}
		expected := []string{"ada.ns.cloudflare.test", "bob.ns.cloudflare.test"}
		actual := expected
		if z.ns == "invalid" {
			actual = []string{"ns1.parking-registrar.test", "ns2.parking-registrar.test"}
		} else if z.ns != "valid" {
			actual = nil
		}
		var checked any
		if z.ns != "unknown" {
			checked = now.UTC().Add(-2 * time.Hour) // timestamp without time zone
		}
		tx.MustExec(`INSERT INTO dns_managed_domains (id, owner_id, fqdn, dns_account_id, ns_status, ns_last_check, ns_expected, ns_actual) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			zid, owner, z.fqdn, acct, z.ns, checked, pq.Array(expected), pq.Array(actual))
		for k, r := range z.records {
			var synced, syncErr any
			if r[3] == "synced" {
				synced = now.UTC().Add(-time.Duration(k+1) * time.Hour)
			}
			if r[3] == "error" {
				syncErr = "provider API: record name already exists with a different type"
			}
			var prio any
			if r[1] == "MX" {
				prio = 10
			}
			tx.MustExec(`INSERT INTO dns_records (id, dns_domain_id, name, record_type, value, ttl, priority, proxied, sync_status, sync_error, last_synced_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
				id("record", fmt.Sprintf("%s/%d", z.fqdn, k)), zid, r[0], r[1], r[2], []int{300, 600, 3600}[k%3], prio, z.provider == "cloudflare" && r[1] == "A" && k%2 == 0, r[3], syncErr, synced)
		}
	}

	for k, b := range bans {
		var src any
		if b[2] != "" {
			src = machineID[b[2]]
		}
		details := map[string]any{"seed": true, "hits": 3 + rng.Intn(400)}
		if b[1] == "bad_user_agent" {
			details["user_agent"] = []string{"sqlmap/1.7.2#stable", "zgrab/0.x", "Nuclei - Open-source project"}[k%3]
		}
		if b[1] == "endpoint_scan" {
			details["paths"] = []string{"/.env", "/wp-login.php", "/.git/config", "/phpmyadmin/"}
		}
		dj, _ := json.Marshal(details)
		banned := now.Add(-time.Duration(rng.Intn(20*24)+1) * time.Hour)
		tx.MustExec(`INSERT INTO security_ip_bans (ip_address, source_machine_id, reason, details, banned_at, expires_at, created_by, is_active)
			VALUES ($1,$2,$3,$4,$5,$6,$7,true) ON CONFLICT (ip_address) DO NOTHING`,
			b[0], src, b[1], string(dj), banned, banned.Add(30*24*time.Hour), owner)
	}
}

// healthFields turns a seed health keyword into the persisted columns.
func healthFields(d domainSeed, rng *rand.Rand) (status string, code, ms, checkErr any) {
	expect := d.expect
	if expect == 0 {
		expect = 200
	}
	switch d.health {
	case "healthy":
		return "healthy", expect, 40 + rng.Intn(400), nil
	case "unhealthy":
		return "unhealthy", []int{502, 503, 500}[rng.Intn(3)], 900 + rng.Intn(4000), nil
	case "down":
		return "unhealthy", nil, nil, "dial tcp " + d.fqdn + ":443: connect: connection timed out"
	case "proxied":
		return "proxied", nil, nil, "Get \"https://" + d.fqdn + "/\": remote error: tls: handshake failure"
	case "":
		return "linked", nil, nil, nil
	}
	return "idle", nil, nil, nil
}

func insertJob(tx *sqlx.Tx, jid, agent, owner uuid.UUID, title, action, entityType, entityID, status string, errMsg any, created time.Time) {
	var started, finished, hooks any
	timeout := 900
	logs := "[agent] job received\n"
	switch status {
	case "running":
		started = time.Now().Add(-20 * time.Second)
		timeout = 7 * 24 * 3600 // seeded agents never report back; keep the reaper off it
		logs += "[agent] writing /etc/nginx/sites-available/config\n[agent] nginx -t\n"
	case "completed", "failed", "cancelled":
		started = created.Add(2 * time.Second)
		finished = created.Add(time.Duration(4+len(title)%20) * time.Second)
		hooks = finished
		if status == "completed" {
			logs += "[agent] step 1/3 ok\n[agent] step 2/3 ok\n[agent] step 3/3 ok\n[agent] done\n"
		} else if status == "failed" {
			logs += "[agent] step 1/3 ok\n[agent] step 2/3 FAILED\n"
		} else {
			logs += "[server] cancelled by user\n"
		}
	default:
		logs = ""
	}
	var e any = errMsg
	if s, ok := errMsg.(string); ok && s == "" {
		e = nil
	}
	tx.MustExec(`INSERT INTO jobs (id, agent_id, type, payload_json, status, logs, started_at, finished_at, created_at, updated_at, title, action, created_by,
			entity_type, entity_id, error_message, timeout_seconds, attempts, hooks_processed_at)
		VALUES ($1,$2,'run','{"seed":true}',$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
		jid, agent, status, sql.NullString{String: logs, Valid: logs != ""}, started, finished, created, title, action, owner, entityType, entityID, e, timeout,
		map[bool]int{true: 1, false: 0}[status != "pending"], hooks)
}

// runKeepalive mimics agent heartbeats for seeded "online" machines and undoes the backend
// health checker's verdict on seeded domains (their .test names never resolve).
func runKeepalive(db *sqlx.DB) {
	fmt.Println("Keepalive running (Ctrl+C to stop)...")
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		for _, m := range machines {
			if m.state == "offline" || m.state == "never" {
				continue
			}
			cpu := m.cpu + (rng.Float64()-0.5)*12
			if cpu < 1 {
				cpu = 1
			}
			if cpu > 100 {
				cpu = 100
			}
			if _, err := db.Exec(`UPDATE agents SET last_seen = NOW() WHERE id = $1`, id("agent", m.host)); err != nil {
				log.Printf("heartbeat %s: %v", m.host, err)
			}
			_, _ = db.Exec(`UPDATE machines SET cpu_percent = $1 WHERE id = $2`, cpu, id("machine", m.host))
		}
		hrng := rand.New(rand.NewSource(42))
		for _, d := range domains {
			status, code, ms, checkErr := healthFields(d, hrng)
			_, _ = db.Exec(`UPDATE domains SET status = $1, last_check_status_code = $2, last_check_response_ms = $3, last_check_error = $4
				WHERE id = $5 AND (status IS DISTINCT FROM $1 OR last_check_error IS DISTINCT FROM $4)`, status, code, ms, checkErr, id("domain", d.fqdn))
		}
		select {
		case <-stop:
			return
		case <-t.C:
		}
	}
}

func must(err error) {
	if err != nil {
		log.Fatal(err)
	}
}
