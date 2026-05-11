# Vercel Deployment Guide

Deploy anon-spliit to Vercel with Vercel Postgres.

> **Note:** Vercel Postgres requires a **Pro plan** ($20/month). For free tier deployment, see [Supabase + Vercel guide](./supabase.md).

## Prerequisites

- [Vercel account](https://vercel.com) **(Pro plan required)**
- [GitHub account](https://github.com) (for repository import)

## Step 1: Fork or Import Repository

1. Fork the [anon-spliit repository](https://github.com/sora-grayscale/spliit)
2. Go to [Vercel Dashboard](https://vercel.com/dashboard)
3. Click "Add New" → "Project"
4. Import your forked repository
5. **Do not deploy yet** - configure database first

## Step 2: Create Vercel Postgres Database

1. In Vercel Dashboard, go to "Storage" tab (top navigation)
2. Click "Create" → "Postgres"
3. Enter a database name (e.g., `anon-spliit-db`)
4. Select a region close to your users
5. Click "Create"
6. After creation, click "Connect to Project"
7. Select your anon-spliit project
8. Click "Connect"

This automatically adds the following environment variables to your project:
- `POSTGRES_URL`
- `POSTGRES_PRISMA_URL`
- `POSTGRES_URL_NON_POOLING`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DATABASE`
- `POSTGRES_HOST`

## Step 3: Deploy (First Time)

1. Go back to your project in Vercel
2. Click "Deployments" tab
3. Click "Redeploy" on the latest deployment (or trigger a new deploy)
4. Wait for the build to complete
5. Note your deployment URL (e.g., `https://your-project.vercel.app`)

The first deployment creates the database tables automatically via Prisma migrations.

## Step 4: Configure Optional Environment Variables

Go to project "Settings" → "Environment Variables" to add optional variables.

### Auto-Deletion Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTO_DELETE_INACTIVE_DAYS` | `90` | Days of inactivity before auto-deletion |
| `DELETE_GRACE_PERIOD_DAYS` | `7` | Grace period before permanent deletion |
| `CRON_SECRET` | - | Secret for cron job authentication (see below) |

**Generating CRON_SECRET:**

Run this command in your terminal to generate a secure secret:

```bash
openssl rand -base64 32
```

Copy the output and paste it as the value for `CRON_SECRET`.

### Private Instance Mode (Optional)

To require authentication for group creation:

| Variable | Description |
|----------|-------------|
| `PRIVATE_INSTANCE` | Set to `true` to enable |
| `ADMIN_EMAIL` | Admin user email (e.g., `admin@example.com`) |
| `ADMIN_PASSWORD` | Admin user password (use a strong password) |
| `NEXTAUTH_SECRET` | Secret for JWT signing (see below) |
| `NEXTAUTH_URL` | Your deployment URL from Step 3 |

**Generating NEXTAUTH_SECRET:**

```bash
openssl rand -base64 32
```

**Setting NEXTAUTH_URL:**

Use your Vercel deployment URL from Step 3:
- Default: `https://your-project.vercel.app`
- With custom domain: `https://yourdomain.com`

**Important:** After adding Private Instance variables, redeploy for changes to take effect.

The admin user is **automatically created** when you first access the login page - no manual initialization required.

### Document Upload (Optional)

To enable expense document uploads (requires S3-compatible storage):

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS` | Set to `true` to enable |
| `S3_UPLOAD_KEY` | S3 access key |
| `S3_UPLOAD_SECRET` | S3 secret key |
| `S3_UPLOAD_BUCKET` | S3 bucket name |
| `S3_UPLOAD_REGION` | S3 region (e.g., `us-east-1`) |
| `S3_UPLOAD_ENDPOINT` | S3 endpoint (for non-AWS providers like Cloudflare R2) |

## Step 5: Verify Deployment

1. Visit your deployment URL
2. Create a test group
3. Add a test expense
4. Verify the app works correctly

## Custom Domain (Optional)

1. Go to project "Settings" → "Domains"
2. Enter your custom domain
3. Configure DNS as instructed by Vercel:
   - For apex domain: Add an `A` record pointing to Vercel's IP
   - For subdomain: Add a `CNAME` record pointing to `cname.vercel-dns.com`
4. Wait for DNS propagation (can take up to 48 hours)
5. **If using Private Instance Mode:** Update `NEXTAUTH_URL` to your custom domain

## Setting Up Cron Jobs (Optional)

To enable automatic deletion of inactive groups:

1. Create a `vercel.json` in your project root:

```json
{
  "crons": [{
    "path": "/api/cron/cleanup",
    "schedule": "0 0 * * *"
  }]
}
```

2. Set the `CRON_SECRET` environment variable (see above)
3. Redeploy to activate cron jobs

Note: Cron jobs require Vercel Pro plan or higher.

## Troubleshooting

### Database Connection Errors

- Ensure Vercel Postgres is connected to your project
- Check "Storage" tab shows database is connected
- Verify `POSTGRES_PRISMA_URL` and `POSTGRES_URL_NON_POOLING` exist in environment variables

### Migration Errors

Migrations run automatically during build. If issues occur:

```bash
# Install Vercel CLI
npm i -g vercel

# Pull environment variables
vercel env pull .env.local

# Run migrations manually
npx prisma migrate deploy
```

### Private Instance Mode Not Working

1. Verify all required variables are set:
   - `PRIVATE_INSTANCE=true`
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL`
2. Ensure `NEXTAUTH_URL` exactly matches your deployment URL (no trailing slash)
3. Redeploy after changing environment variables

### "Invalid environment variables" Error

Check Vercel build logs for specific missing variables. Common issues:
- `POSTGRES_PRISMA_URL` not set → Connect Vercel Postgres to project
- Private Instance variables incomplete → Set all required variables or disable `PRIVATE_INSTANCE`
