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

## Quick Start

### Prerequisites
- Node.js 20+ / pnpm
- Go 1.23+
- PostgreSQL 14+
- [Task](https://taskfile.dev/) (optional)

### Setup

1. **Create `.env`** from `.env.example`:
```bash
cp .env.example .env
# Edit .env with your database connection
```

2. **Create PostgreSQL database**:
```sql
CREATE DATABASE configuratix;
```

3. **Start development**:
```bash
task dev
```

Or manually:
```bash
# Terminal 1 - Backend
cd backend
go run cmd/server/main.go

# Terminal 2 - Frontend
cd frontend
pnpm dev
```

4. **Access the app**:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8080

5. **First-time setup**:
- Visit http://localhost:3000
- Create your admin account
- Start managing your infrastructure!

## Agent Installation

1. In the web UI, go to **Machines** → **Create Enrollment Token**
2. Copy the install command
3. Run on your Ubuntu server:
```bash
curl -sSL http://YOUR_SERVER:8080/install.sh | sudo bash -s -- YOUR_TOKEN
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
├── Taskfile.yml      # Task runner config
└── .env.example      # Environment template
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | required |
| `BACKEND_PORT` | Backend server port | 8080 |
| `FRONTEND_PORT` | Frontend dev server port | 3000 |
| `JWT_SECRET` | Secret for JWT signing | change-me |
| `CHECK_INTERVAL_HOURS` | Domain health check interval | 1 |

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

## Development

```bash
# Run all tasks
task --list

# Development
task dev          # Start backend + frontend
task dev:backend  # Backend only
task dev:frontend # Frontend only

# Build
task build        # Build both
task build:backend
task build:frontend

# Database
task db:check     # Test connection
task db:migrate   # Run migrations

# Cleanup
task clean
```

## License

MIT
