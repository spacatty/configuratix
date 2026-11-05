# Configuratix

A control plane for managing proxy servers with agent-based configuration management.

## Features

### Web UI (Next.js + shadcn/ui)
- **Dark theme** with deep-red neon accent
- **Sidebar navigation**
- **Dashboard** with real-time stats
- **Machines management**
  - Enrollment tokens with one-liner install command
  - Machine details with system stats
  - Markdown notes
  - UFW firewall management
- **Domains management**
  - Create and assign domains to machines
  - Link nginx configurations
  - Status indicators (gray/green/red)
- **Nginx Configurations**
  - UI builder (SSL modes, CORS, locations)
  - Raw config editor
  - Auto-generate from structured form
- **Settings page**

### Backend (Go)
- JWT authentication
- First-user setup flow
- RESTful API for all resources
- Agent enrollment with secure tokens
- Job queue for agent tasks
- Hourly domain health checks (configurable)

### Agent (Go)
- One-liner installation for Ubuntu 22.04/24.04
- Automatic enrollment
- Job execution:
  - `bootstrap_machine` - Install nginx, certbot, fail2ban, ufw
  - `apply_domain` - Configure nginx + SSL certificate
  - `remove_domain` - Remove nginx configuration
- Heartbeat reporting
- Runs as systemd service

## Production (Docker)

Requirements: Docker with the compose plugin, and an existing PostgreSQL 14+ (the database is not containerized).

```bash
cp .env.example .env      # set DATABASE_URL, JWT_SECRET, ports
docker compose up -d --build
```

Three containers start:

| Container | Purpose | Host port (`.env`) |
|-----------|---------|--------------------|
| `gateway`  | One origin for UI + `/api` + websockets + `install.sh`. **Point your reverse proxy here.** | `APP_PORT` (8000) |
| `backend`  | Go API; runs migrations and builds agent binaries on start | `BACKEND_PORT` (8080) |
| `frontend` | Next.js UI | `FRONTEND_PORT` (3000) |

All ports bind to `BIND_ADDR` (use `127.0.0.1` when only a local proxy connects; Docker-published ports bypass ufw).
The gateway honours `X-Forwarded-Proto` / `X-Forwarded-Host` from your proxy, so agent install URLs come out right behind TLS.

`PUBLIC_API_URL` is the backend URL the browser uses. Leave it empty when everything goes through the gateway (same origin); set it (e.g. `https://api.example.com`) for a split UI/API domain. It is read at runtime: change `.env`, then `docker compose up -d`.

Day-to-day: `task prod` (build + restart), `task prod:logs -- backend`, `task prod:ps`, `task prod:down`.

### Migrating an existing (pre-Docker) install

Nothing in the database or on disk is converted; the containers reuse it in place.

1. Back up the database.
2. Stop the old processes (they hold the same ports): stop whatever ran `task prod` / the Go server and `next start`.
3. Keep your `.env`. Check two things:
   - `DATABASE_URL` pointing at `localhost`/`127.0.0.1`: change the host to `host.docker.internal` (inside a container, localhost is the container).
   - `JWT_SECRET` is set (otherwise users are logged out on every restart).
4. `docker compose up -d --build`, then `task prod:logs -- backend` until `Server starting`.

Why this is safe for agents and your proxy:
- `BACKEND_PORT` / `FRONTEND_PORT` are published on the same host ports as before, so existing proxy rules and agents that talk to `http://<server>:<BACKEND_PORT>` keep working without changes.
- An existing `NEXT_PUBLIC_API_URL` in `.env` is honoured at runtime when `PUBLIC_API_URL` is empty, so a split UI/API domain setup keeps working as-is.
- Landing uploads stay in `backend/data` (bind-mounted; override with `DATA_DIR`).

Optional, later: point the proxy at `APP_PORT` for both the UI and the API domain, empty `PUBLIC_API_URL` / `NEXT_PUBLIC_API_URL`, and set `BIND_ADDR=127.0.0.1`.

## Development

### Prerequisites
- Node.js 20+ / pnpm
- Go 1.23+
- PostgreSQL 14+
- [Task](https://taskfile.dev/) (optional)

1. `cp .env.example .env`, set `DATABASE_URL`, and for the dev server `NEXT_PUBLIC_API_URL=http://localhost:<BACKEND_PORT>`.
2. `task dev` (or `go run ./cmd/server` in `backend/` and `pnpm dev` in `frontend/`).
3. Open http://localhost:3000 and create the first admin account.

`dev/test-machine/up.sh <TOKEN>` starts a disposable Ubuntu container with systemd and enrolls it through the real installer.

Other tasks: `task --list` (`dev:backend`, `dev:frontend`, `build`, `db:check`, `db:migrate`, `clean`).

## Agent Installation

1. In the web UI, go to **Machines** → **Create Enrollment Token**
2. Copy the install command
3. Run on your Ubuntu server:
```bash
curl -sSL https://YOUR_SERVER/install.sh | sudo bash -s -- YOUR_TOKEN
```

## Project Structure

```
configuratix/
├── frontend/           # Next.js + shadcn/ui
│   ├── src/
│   │   ├── app/       # App router pages
│   │   ├── components/ # UI components
│   │   └── lib/       # API client, utilities
│   └── package.json
├── backend/           # Go API server
│   ├── cmd/server/    # Main entry point
│   ├── internal/
│   │   ├── auth/      # JWT authentication
│   │   ├── database/  # PostgreSQL connection
│   │   ├── handlers/  # HTTP handlers
│   │   ├── middleware/# Auth, CORS middleware
│   │   ├── models/    # Data models
│   │   └── scheduler/ # Health check scheduler
│   └── migrations/    # SQL migrations
├── agent/            # Go agent for servers
│   ├── cmd/agent/    # Main entry point
│   ├── internal/
│   │   ├── client/   # API client
│   │   ├── config/   # Config management
│   │   └── executor/ # Job execution
│   └── install.sh    # Installation script
├── docker-compose.yml # Production stack (gateway, backend, frontend)
├── deploy/nginx/     # Gateway config template
├── Taskfile.yml      # Dev tasks + docker wrappers
└── .env.example      # Environment template
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string (`host.docker.internal` for a Postgres on the Docker host) | required |
| `JWT_SECRET` | Signs login tokens; keep stable, 32+ chars | random per start |
| `APP_PORT` | Host port of the single-origin gateway | 8000 |
| `BACKEND_PORT` | Host port of the backend (dev: its listen port) | 8080 |
| `FRONTEND_PORT` | Host port of the UI (dev: its listen port) | 3000 |
| `BIND_ADDR` | Host address the Docker ports bind to | 0.0.0.0 |
| `PUBLIC_API_URL` | Backend URL used by the browser; empty = same origin | empty |
| `NEXT_PUBLIC_API_URL` | Dev API URL; legacy fallback for `PUBLIC_API_URL` | - |
| `DATA_DIR` | Host directory for landing uploads | ./backend/data |
| `GATEWAY_MAX_BODY_SIZE` | Upload limit through the gateway | 512m |
| `CHECK_INTERVAL_HOURS` | Domain health check interval | 1 |
| `AGENT_VERSION` | Override the agent version to build/serve | from image |

## API Endpoints

### Public
- `GET /api/setup/status` - Check if setup needed
- `POST /api/setup/create-admin` - Create first admin
- `POST /api/auth/login` - Login
- `POST /api/agent/enroll` - Agent enrollment

### Protected (requires JWT)
- `GET/POST /api/machines` - List/create machines
- `GET/PUT/DELETE /api/machines/:id` - Machine operations
- `GET/POST /api/domains` - List/create domains
- `PUT /api/domains/:id/assign` - Assign domain to machine
- `GET/POST /api/nginx-configs` - List/create configs
- `GET/POST /api/enrollment-tokens` - Enrollment tokens
- `GET/POST /api/jobs` - Job management

### Agent (requires API key)
- `POST /api/agent/heartbeat` - Agent heartbeat
- `GET /api/agent/jobs` - Get pending jobs
- `POST /api/agent/jobs/update` - Update job status

## Health Check Status

| Status | Description |
|--------|-------------|
| **Gray** | Domain not assigned to any machine |
| **Green** | DNS resolves to machine IP + HTTP(S) responds |
| **Red** | DNS mismatch or HTTP(S) not responding |

## License

MIT
