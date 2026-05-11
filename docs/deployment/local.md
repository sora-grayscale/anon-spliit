# Local Development Setup

Set up anon-spliit for local development.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) package manager
- [Docker](https://www.docker.com/) or [Podman](https://podman.io/) (for PostgreSQL)

## Quick Start

### 1. Clone Repository

```bash
git clone https://github.com/sora-grayscale/spliit.git
cd spliit
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Start PostgreSQL

Using the provided script:

```bash
./scripts/start-local-db.sh
```

This starts PostgreSQL with:
- Host: `localhost`
- Port: `5432`
- User: `postgres`
- Password: `1234`

### 4. Configure Environment

```bash
cp .env.example .env
```

The default `.env.example` is configured for local development and should work out of the box.

### 5. Run Database Migrations

```bash
pnpm db:migrate
```

### 6. Start Development Server

```bash
pnpm dev
```

Visit [http://localhost:3000](http://localhost:3000)

## Environment Variables

### Required

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_PRISMA_URL` | `postgresql://postgres:1234@localhost` | Database URL |
| `POSTGRES_URL_NON_POOLING` | `postgresql://postgres:1234@localhost` | Database URL (non-pooling) |

### Auto-Deletion Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTO_DELETE_INACTIVE_DAYS` | `90` | Days before inactive groups are marked for deletion |
| `DELETE_GRACE_PERIOD_DAYS` | `7` | Days in grace period before permanent deletion |
| `CRON_SECRET` | - | Secret for authenticating cron job requests |

### Private Instance Mode

| Variable | Default | Description |
|----------|---------|-------------|
| `PRIVATE_INSTANCE` | `false` | Enable authentication requirement |
| `ADMIN_EMAIL` | - | Admin user email |
| `ADMIN_PASSWORD` | - | Admin user password |
| `NEXTAUTH_SECRET` | - | JWT signing secret |
| `NEXTAUTH_URL` | - | App URL for NextAuth |

### Document Upload (S3)

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS` | `false` | Enable document uploads |
| `S3_UPLOAD_KEY` | - | S3 access key |
| `S3_UPLOAD_SECRET` | - | S3 secret key |
| `S3_UPLOAD_BUCKET` | - | S3 bucket name |
| `S3_UPLOAD_REGION` | - | S3 region |
| `S3_UPLOAD_ENDPOINT` | - | S3 endpoint (non-AWS) |

### Other

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:3000` | Base URL for the app |
| `NEXT_PUBLIC_DEFAULT_CURRENCY_CODE` | - | Default currency code |

## Common Commands

```bash
# Development
pnpm dev                    # Start dev server
pnpm build                  # Production build
pnpm start                  # Start production server

# Database
pnpm db:migrate             # Run migrations
pnpm db:studio              # Open Prisma Studio

# Testing
pnpm test                   # Run tests
pnpm test:watch             # Run tests in watch mode

# Code Quality
pnpm lint                   # Run ESLint
pnpm format                 # Run Prettier
npx tsc --noEmit            # Type check
```

## Testing Private Instance Mode

1. Set environment variables:

```bash
PRIVATE_INSTANCE=true
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your-secure-password
NEXTAUTH_SECRET=your-secret-key
NEXTAUTH_URL=http://localhost:3000
```

2. Restart dev server
3. Try accessing `/groups/create` - you should be redirected to login
4. Login with admin credentials

## Troubleshooting

### PostgreSQL Connection Failed

Ensure PostgreSQL is running:

```bash
# Check container status
docker ps

# Restart if needed
./scripts/start-local-db.sh
```

### Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000

# Kill process
kill -9 <PID>
```

### Migration Errors

```bash
# Reset database (WARNING: deletes all data)
pnpm db:push --force-reset

# Or recreate container
docker rm -f spliit-postgres
./scripts/start-local-db.sh
pnpm db:migrate
```
