# Configuratix Backend

Go backend API for Configuratix proxy management system.

## Setup

1. Install PostgreSQL and create a database:
```sql
CREATE DATABASE configuratix;
```

2. Set environment variables (or use `.env` file):
```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/configuratix?sslmode=disable"
export PORT=8080
export JWT_SECRET="your-secret-key-here"
```

3. Run migrations (automatically on startup):
```bash
go run cmd/server/main.go
```

## Default Admin

- Email: `admin@configuratix.local`
- Password: `admin123`

**Change this immediately in production!**

## API Endpoints

### Auth
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user (requires auth)

