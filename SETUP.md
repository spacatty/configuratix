# Setup Instructions

## Prerequisites

1. **PostgreSQL** - Install and start PostgreSQL
2. **Node.js/pnpm** - For frontend (or use standalone pnpm)
3. **Go 1.23+** - For backend

## Step 1: Database Setup

Create the database:

```sql
CREATE DATABASE configuratix;
```

## Step 2: Start Backend

Open a terminal in the `backend` directory:

```bash
cd backend

# Set database URL (adjust as needed)
$env:DATABASE_URL="postgres://postgres:postgres@localhost:5432/configuratix?sslmode=disable"

# Run the server
go run cmd/server/main.go
```

The backend will:
- Connect to PostgreSQL
- Run migrations automatically
- Create default admin user

**Default Admin Credentials:**
- Email: `admin@configuratix.local`
- Password: `admin123`

You should see:
```
Server starting on port 8080
Created default admin user: admin@configuratix.local / admin123
```

## Step 3: Start Frontend

Open another terminal in the `frontend` directory:

```bash
cd frontend

# Install dependencies (if not already done)
pnpm install

# Start dev server
pnpm dev
```

The frontend will start on http://localhost:3000

## Step 4: Test Authentication

1. Open http://localhost:3000 in your browser
2. You should be redirected to `/login`
3. Enter credentials:
   - Email: `admin@configuratix.local`
   - Password: `admin123`
4. Click "Sign in"
5. You should be redirected to `/dashboard`

## Troubleshooting

### Backend won't start
- Check PostgreSQL is running: `pg_isready`
- Verify DATABASE_URL is correct
- Check if port 8080 is available

### Frontend can't connect to backend
- Verify backend is running on port 8080
- Check browser console for CORS errors
- Ensure `NEXT_PUBLIC_API_URL` is set correctly (defaults to http://localhost:8080)

### Migration errors
- Ensure you're running from the `backend` directory
- Check that `migrations/001_initial_schema.sql` exists
- Verify database connection string is correct

