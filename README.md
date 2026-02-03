<p align="center">
  <img src="public/anon-spliit.png" alt="anon-spliit" width="300" />
</p>

<h1 align="center">anon spliit</h1>

<p align="center">
  <strong>Anonymous bill splitting with end-to-end encryption</strong>
</p>

<p align="center">
  <a href="https://github.com/sponsors/sora-grayscale">
    <img src="https://img.shields.io/github/sponsors/sora-grayscale?style=flat-square&logo=github&label=Sponsor" alt="GitHub Sponsors" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-green.svg?style=flat-square" alt="License: MIT" />
  </a>
  <a href="https://x.com/sora_grayscale">
    <img src="https://img.shields.io/badge/Twitter-@sora__grayscale-1DA1F2?style=flat-square&logo=x" alt="Twitter" />
  </a>
</p>

---

**anon-spliit** is a privacy-focused fork of [Spliit](https://github.com/spliit-app/spliit). All user data is **end-to-end encrypted (E2EE)** - the server stores only encrypted blobs and never sees your actual data.

## Why anon-spliit?

- **True Privacy**: Your expense data is encrypted before it leaves your browser
- **Zero-Knowledge**: The server cannot read your group names, participants, or amounts
- **No Accounts**: Share groups via encrypted links - no sign-up required
- **Open Source**: Fully transparent, self-hostable, and auditable

## Privacy Features

| Feature                   | Description                                              |
| ------------------------- | -------------------------------------------------------- |
| **E2E Encryption**        | AES-128-GCM encryption with keys stored in URL fragments |
| **Zero-Knowledge Server** | Server only stores encrypted data                        |
| **Password Protection**   | Optional PBKDF2-based password for additional security   |
| **Two-Factor Authentication (2FA)** | TOTP-based with backup codes for recovery |
| **No Tracking**           | No analytics, no cookies, no fingerprinting              |

## What's Encrypted

**All sensitive user data is encrypted client-side before being sent to the server.**

| Data                | Encrypted |
| ------------------- | :-------: |
| Group name          |    ✅     |
| Group description   |    ✅     |
| Group currency      |    ✅     |
| Group currency code |    ✅     |
| Participant names   |    ✅     |
| Expense titles      |    ✅     |
| Expense notes       |    ✅     |
| Expense amounts     |    ✅     |
| Expense category    |    ✅     |
| Original currency   |    ✅     |
| Split shares        |    ✅     |
| Activity log data   |    ✅     |

**The server cannot decrypt any of this data** - encryption keys exist only in the URL fragment (never sent to the server) and optionally in your browser's localStorage.

## Features

- Split expenses evenly or by custom amounts/percentages/shares
- Track balances and get optimized reimbursement suggestions
- Support for multiple currencies with exchange rates
- Attach receipts and documents to expenses
- Export data to JSON/CSV
- Progressive Web App (PWA) - install on mobile
- Dark mode support
- Multi-language (English, Japanese, and more)
- **Private Instance Mode** - Restrict access to whitelisted users
- **Two-Factor Authentication (2FA)**
  - TOTP-based authentication for enhanced security
  - QR code setup for easy enrollment
  - Backup codes for account recovery
  - Rate-limited verification to prevent brute force attacks

## Quick Start

### Deploy Your Own Instance

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fsora-grayscale%2Fspliit&project-name=my-anon-spliit&repository-name=my-anon-spliit&stores=%5B%7B%22type%22%3A%22postgres%22%7D%5D)

### Run Locally

```bash
# Clone the repository
git clone https://github.com/sora-grayscale/anon-spliit.git
cd anon-spliit

# Start PostgreSQL
./scripts/start-local-db.sh

# Setup environment
cp .env.example .env

# Install and run
pnpm install
pnpm dev
```

### Run with Docker/Podman

```bash
# Copy and configure environment
cp container.env.example container.env
# Edit container.env with your settings (especially POSTGRES_PASSWORD)

# Build and run with Docker
docker compose up -d

# Or with Podman
podman-compose up -d
```

**Alternative: Build image separately**

```bash
# Build the image
./scripts/build-image.sh

# Then start services
docker compose up -d
# or: podman-compose up -d
```

**Services:**
- App: http://localhost:3000
- Database: PostgreSQL (internal, port 5432)

## Private Instance Mode

For self-hosted deployments, you can restrict access to whitelisted users only.

### Setup

```bash
# Enable private instance mode
PRIVATE_INSTANCE=true

# Initial admin credentials
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your-secure-password

# NextAuth.js configuration
NEXTAUTH_SECRET=your-secret-key
NEXTAUTH_URL=https://your-domain.com
```

### Features

- **Admin Dashboard** - Manage whitelisted users at `/admin`
- **Initial Password** - Users receive a generated password that must be changed on first login
- **Password Reset** - Admins can reset user passwords
- **Shared Group Access** - Shared links still work without authentication (protected by encryption key)
- **Group Creation** - Only whitelisted users can create new groups

## Environment Variables

### Authentication & Security

```bash
# Two-Factor Authentication (2FA)
TWO_FA_ENCRYPTION_KEY=<256-bit hex key>  # Optional - encryption key for 2FA secrets

# Generate with:
# openssl rand -hex 32
```

### Database

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/spliit
```

### NextAuth.js (Private Instance Mode)

```bash
NEXTAUTH_SECRET=your-secret-key
NEXTAUTH_URL=https://your-domain.com
```

## Tech Stack

| Category   | Technology                                 |
| ---------- | ------------------------------------------ |
| Frontend   | Next.js 16, React, TypeScript, TailwindCSS |
| Backend    | tRPC, Prisma ORM                           |
| Database   | PostgreSQL                                 |
| Encryption | Web Crypto API (AES-128-GCM, HKDF, PBKDF2) |
| UI         | shadcn/ui                                  |

## Security

### How Encryption Works

1. **Key Generation**: A random 128-bit key is generated when creating a group
2. **Key Storage**: The key is stored in the URL fragment (`#key`) - this part is never sent to the server
3. **Encryption**: All sensitive data is encrypted client-side using AES-128-GCM
4. **Password Protection**: Optionally add a password using PBKDF2 (100,000 iterations)

### Best Practices

- Share group links only with trusted people
- Use password protection for sensitive financial data
- Don't share URLs in screenshots (they contain your encryption key)
- Self-host for maximum privacy

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/spliit.git

# Create a branch
git checkout -b feature/your-feature

# Make changes and test
pnpm test
pnpm build

# Submit a PR
```

## Support the Project

If you find anon-spliit useful:

- [Sponsor on GitHub](https://github.com/sponsors/sora-grayscale)
- Star this repository
- Share with friends who value privacy
- Report bugs or suggest features

## Attribution

This project is a fork of [Spliit](https://github.com/spliit-app/spliit). The original project is an excellent expense splitting app - this fork adds end-to-end encryption for enhanced privacy.

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<p align="center">
  <strong>anon-spliit</strong> - Your expenses, your privacy.
</p>
