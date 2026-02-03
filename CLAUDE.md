# anon-spliit - Development Guide

> Anonymous bill splitting with end-to-end encryption

## Project Overview

**anon-spliit** is a privacy-focused fork of [Spliit](https://github.com/spliit-app/spliit). All user data is **end-to-end encrypted (E2EE)** - the server never sees unencrypted data. The encryption key is stored in the URL fragment and never sent to the server.

**Repository**: https://github.com/sora-grayscale/anon-spliit
**Twitter/X**: [@sora_grayscale](https://x.com/sora_grayscale)

## Architecture

### Tech Stack

- **Frontend**: Next.js 16 (App Router), React, TypeScript, TailwindCSS
- **Backend**: tRPC, Prisma ORM
- **Database**: PostgreSQL
- **Encryption**: Web Crypto API (AES-128-GCM, HKDF SHA-256)
- **Deployment**: Vercel, Docker/Podman

### E2EE Design Philosophy

- **Zero-knowledge server**: The server never sees unencrypted data
- **URL fragment key storage**: Encryption key in `#<base64key>` format (never sent to server)
- **localStorage persistence**: Keys saved per-group for convenience
- **Everything encrypted**: Group names, participant names, expense titles, notes, amounts, categories, currency

### Key Files

```
src/lib/crypto.ts              # Core crypto utilities (PBKDF2, key derivation, password generation, cached deriveKey)
src/lib/encrypt-helpers.ts     # Encryption/decryption helpers (amount, category, currency, title, notes)
src/lib/totals.ts              # Stats calculation utilities
src/lib/hooks/useBalances.ts   # Client-side balance calculation with decryption
src/lib/auto-delete.ts         # Auto-delete inactive groups (Issue #10)
src/lib/two-factor.ts          # 2FA utilities (TOTP, backup codes, encryption) (Issue #18)
src/lib/rate-limit.ts          # Rate limiting utilities (Issue #18)
src/app/groups/[groupId]/expenses/category-icon.tsx  # Static category mapping for E2EE (Issue #19)
src/components/encryption-provider.tsx  # React context for encryption (handles password protection)
src/components/password-prompt.tsx      # Password entry component with rate limiting
src/lib/hooks/use-group-url.ts # URL navigation with key preservation
src/app/groups/[groupId]/stats/totals.tsx  # Client-side stats with decryption
src/app/api/cron/auto-delete/route.ts  # Cron endpoint for auto-deletion
src/app/api/2fa/*              # 2FA API endpoints (enable, disable, verify) (Issue #18)
src/app/auth/verify-2fa/*      # 2FA verification pages (Issue #18)
src/app/admin/two-factor-setup.tsx  # 2FA setup component (Issue #18)
src/lib/auth.ts                    # NextAuth.js configuration (Issue #4)
src/proxy.ts                       # Route protection proxy (Issue #4, Next.js 16)
src/app/admin/                     # Admin dashboard (Issue #4)
src/components/auth-provider.tsx   # NextAuth SessionProvider wrapper
src/components/user-menu.tsx       # User dropdown menu component
src/components/password-change-guard.tsx  # Force password change redirect
src/__tests__/private-instance.test.ts    # Private instance mode tests
```

## Development Rules

### 1. Version Control with jj (Jujutsu)

- Use `jj` instead of `git` for version control
- Leverage parallel development with multiple changes
- Common commands:
  ```bash
  jj status                    # Check status
  jj log                       # View history
  jj new                       # Create new change
  jj describe -m "message"     # Set commit message
  jj git push --change @       # Push current change
  ```

### 2. Branch/PR Strategy

- **1 feature = 1 branch = 1 PR**
- Keep PRs small and focused
- Use descriptive branch names: `feature/password-protection`, `feature/amount-encryption`
- Always base new features on `main`

### 3. Testing Requirements

- **All features must have tests**
- Run tests before pushing: `pnpm test`
- Test encryption thoroughly:
  - Encrypt/decrypt round-trip
  - Invalid key handling
  - Legacy (unencrypted) data compatibility
- Security tests for crypto operations

### 4. Code Quality

- **TypeScript strict mode**: No `any` types without justification
- Run type check: `npx tsc --noEmit`
- Keep code maintainable and readable
- Add comments for complex crypto operations
- Use meaningful variable names

### 5. Code Review & Refactoring

- Regular code reviews on PRs
- Refactor when code becomes complex
- Keep functions small and focused
- DRY principle but avoid premature abstraction

### 6. Documentation

- **Update CLAUDE.md** with every significant change
- Keep feature specifications current
- Document environment variables
- Add inline comments for complex logic

## Feature Roadmap

### Priority: HIGH

#### Issue #6: Group Deletion

**Status**: DONE
**Priority**: HIGH
**Link**: https://github.com/sora-grayscale/anon-spliit/issues/6

- [x] Delete button with confirmation dialog (group name input required)
- [x] Soft delete (sets `deletedAt` field)
- [x] Grace period display (7 days before permanent deletion)
- [x] Deleted group screen with restore/permanent delete options
- [x] Days remaining countdown
- [x] "Scheduled for deletion" section in groups list
- [x] Auto-cleanup of permanently deleted groups from localStorage
- [x] Share button includes encryption key in URL

#### Issue #10: Auto-delete Inactive Groups

**Status**: DONE
**Priority**: LOW
**Link**: https://github.com/sora-grayscale/anon-spliit/issues/10

- [x] Environment variable configuration (`AUTO_DELETE_INACTIVE_DAYS`, `DELETE_GRACE_PERIOD_DAYS`, `CRON_SECRET`)
- [x] Track last activity date per group (using Activity table)
- [x] Cron API endpoint (`/api/cron/auto-delete`)
- [x] Soft-delete inactive groups automatically
- [x] Permanent deletion of groups past grace period
- [x] Vercel Cron configuration (daily at 3:00 AM UTC)
- [x] Unit tests for auto-delete functionality

#### Issue #3: Amount Encryption (Complete E2EE)

**Status**: DONE
**Priority**: HIGH
**Link**: https://github.com/sora-grayscale/anon-spliit/issues/3

- [x] Encrypt amounts on client before sending
- [x] Decrypt on client for display/calculation
- [x] Server stores only encrypted values (String type in DB)
- [x] Balance calculation done client-side (useBalances hook)
- [x] All financial data fully encrypted (amount, originalAmount, shares)

#### Issue #19: Category Encryption (Complete E2EE)

**Status**: DONE
**Priority**: HIGH
**Link**: https://github.com/sora-grayscale/anon-spliit/issues/19

- [x] Encrypt category ID on client before sending
- [x] Decrypt on client for display
- [x] Server stores only encrypted categoryId (String type in DB)
- [x] Removed FK relation between Expense and Category tables
- [x] Static category mapping in CategoryIcon component
- [x] Backward compatibility for legacy unencrypted categoryId values

#### Issue #2: Password Protection

**Status**: DONE
**Priority**: HIGH
**Link**: https://github.com/sora-grayscale/anon-spliit/issues/2

- [x] Password-based key derivation (PBKDF2)
- [x] Password prompt on first access
- [x] Store password hint (optional, encrypted)
- [x] Combine with URL key (double encryption)
- [x] Rate limiting for brute force protection
- [x] Secure password generation button

### Priority: LOW

#### Issue #5: Docker/Podman Deployment

**Status**: DONE
**Priority**: LOW
**Link**: https://github.com/sora-grayscale/anon-spliit/issues/5

- [x] Dockerfile for production build (multi-stage, pnpm)
- [x] compose.yaml with PostgreSQL
- [x] Environment variable configuration (container.env.example)
- [x] Health checks and logging
- [x] Podman compatibility (build-image.sh supports both)
- [x] container-entrypoint.sh for migrations at startup

#### Issue #7: Rebrand to anon-spliit

**Status**: DONE
**Priority**: LOW
**Link**: https://github.com/sora-grayscale/anon-spliit/issues/7

- [x] Update app name and branding
- [x] Update all links and references
- [x] Add donation/sustainability links (GitHub Sponsors)
- [x] Update documentation
- [x] Proper attribution to original project

### Completed

#### Rebrand to anon-spliit (Issue #7) - DONE

- [x] New privacy-focused logo (icon + CSS text approach)
- [x] Small icon for header/footer (anon-spliit-small.png)
- [x] Updated package.json with new name and metadata
- [x] Updated meta tags (title, description, OG tags, Twitter @sora_grayscale)
- [x] Updated manifest.ts for PWA
- [x] Updated messages (en-US, ja-JP) with new branding
- [x] New README.md with privacy features documentation
- [x] LICENSE with proper attribution
- [x] GitHub Sponsors link for donations
- [x] Hero section with blur animation on landing page

#### Password Protection (Issue #2) - DONE

- [x] Schema: passwordSalt, passwordHint added to Group
- [x] PBKDF2 key derivation (100,000 iterations)
- [x] Password prompt component with rate limiting
- [x] Secure password generation utility
- [x] URL key + password key combination (XOR)
- [x] EncryptionProvider handles password-protected groups
- [x] Group creation form with optional password field
- [x] Share button uses urlKey (not combined key) for correct sharing
- [x] Stats calculation moved to client-side (works with encrypted data)

#### Amount Encryption (Issue #3) - DONE

- [x] Schema: amount, originalAmount, shares changed to String
- [x] encryptExpenseFormValues: encrypts amounts and shares
- [x] decryptExpense: decrypts amounts and shares
- [x] Client-side balance calculation (useBalances hook)
- [x] listAll tRPC procedure for balance calculation
- [x] UI components updated for string amounts

#### Group Deletion (Issue #6, PR #9) - MERGED

- [x] Delete button with confirmation dialog
- [x] Soft delete with grace period (7 days)
- [x] Deleted group screen with restore/delete options
- [x] "Scheduled for deletion" section in groups list
- [x] Share button includes encryption key

#### Basic E2EE (PR #1) - MERGED

- [x] Group name encryption
- [x] Participant name encryption
- [x] Expense title/notes encryption
- [x] URL fragment key storage
- [x] localStorage key persistence
- [x] Error screen for missing encryption key

#### Category Encryption (Issue #19) - DONE

- [x] Schema: categoryId changed from Int to String (encrypted)
- [x] Removed FK relation between Expense and Category tables
- [x] encryptExpenseFormValues: encrypts category ID
- [x] decryptExpense: decrypts categoryId (handles legacy plain number/string values)
- [x] CategoryIcon: Static CATEGORY_MAP for categoryId to grouping/name lookup
- [x] getCategoryInfo helper function for category metadata

#### Currency Encryption (Issue #22) - DONE

- [x] Group.currency: encrypted (e.g., "$", "€", "¥")
- [x] Group.currencyCode: encrypted (e.g., "USD", "EUR", "JPY")
- [x] Expense.originalCurrency: encrypted (for multi-currency expenses)
- [x] encryptGroupFormValues: encrypts currency and currencyCode
- [x] decryptGroup: decrypts currency/currencyCode (handles legacy plain values)
- [x] encryptExpenseFormValues: encrypts originalCurrency
- [x] decryptExpense: decrypts originalCurrency (handles legacy plain values)
- [x] Backward compatibility for unencrypted legacy data
- [x] schemas.ts: Removed length validation for currency fields (encrypted strings are longer)
- [x] Tests for currency encryption (117 total tests passing)

#### Private Instance Mode (Issue #4) - DONE

- [x] Prisma schema: Admin and WhitelistUser models with password fields
- [x] NextAuth.js v5 with Credentials provider
- [x] JWT-based session strategy with isAdmin/mustChangePassword claims
- [x] bcryptjs password hashing (12 rounds)
- [x] proxy.ts route protection (Next.js 16 convention)
- [x] Sign in/error/change-password pages
- [x] Admin dashboard with stats and user management
- [x] Whitelist user CRUD API endpoints (POST, GET, DELETE, PATCH)
- [x] Password reset functionality for admins
- [x] Initial password generation with forced change on first login
- [x] PasswordChangeGuard component for redirect enforcement
- [x] UserMenu component in header (shows when authenticated)
- [x] AuthProvider wrapper in layout (conditional on PRIVATE_INSTANCE)
- [x] Security tests (107 total tests passing)
- [x] 2FA integration for admin users (Issue #18)

#### Two-Factor Authentication (Issue #18) - DONE

- [x] TOTP (Time-based One-Time Password) setup with QR code generation
- [x] Backup codes (10 one-time codes for account recovery)
- [x] AES-256-GCM encryption for 2FA secrets storage
- [x] Rate limiting for brute force protection (attempt counting and delays)
- [x] Timing-safe comparison for TOTP verification
- [x] NextAuth.js integration with session handling
- [x] 2FA API endpoints: enable, disable, verify (/api/2fa/\*)
- [x] 2FA verification page during authentication (/auth/verify-2fa)
- [x] Admin two-factor-setup component with setup flow
- [x] Backup code display and download
- [x] Secure secret encryption with TWO_FA_ENCRYPTION_KEY
- [x] Database schema: twoFactorSecret, twoFactorEnabled, backupCodes, attemptCount, lastAttempt fields
- [x] Auto-submit on 6 digits entry in verification form
- [x] Success toast notification on 2FA enable
- [x] Backup code copy/download requirement before enabling

#### Performance Optimizations - DONE

- [x] Derived key caching in crypto.ts (Map with FIFO eviction, max 100 entries)
- [x] Database index on Participant.groupId for faster group participant lookups
- [x] React.memo on ExpenseCard component to prevent unnecessary re-renders
- [x] Promise-based cache to handle concurrent key derivation requests efficiently

## Security Considerations

### Encryption

- Use Web Crypto API (native browser implementation)
- AES-128-GCM for authenticated encryption
- HKDF SHA-256 for key derivation
- Unique IV for each encryption operation

### Key Management

- Never log encryption keys
- Clear keys from memory when not needed
- Validate key format before use
- Handle decryption failures gracefully

### Password Handling

- Use PBKDF2 with high iteration count (100,000+)
- Salt passwords before hashing
- Never store plaintext passwords
- Rate limit password attempts

## Environment Variables

```bash
# Database
POSTGRES_PRISMA_URL=postgresql://user:pass@host:5432/db
POSTGRES_URL_NON_POOLING=postgresql://user:pass@host:5432/db

# Auto-deletion (Issue #10)
AUTO_DELETE_INACTIVE_DAYS=90     # Days of inactivity before auto-deletion (0 to disable)
DELETE_GRACE_PERIOD_DAYS=7       # Days before permanent deletion after soft-delete
CRON_SECRET=                     # Secret for authenticating cron requests

# Private Instance (Issue #4)
PRIVATE_INSTANCE=false           # Enable private instance mode
ADMIN_EMAIL=admin@example.com    # Initial admin email (required when PRIVATE_INSTANCE=true)
ADMIN_PASSWORD=                  # Initial admin password (required when PRIVATE_INSTANCE=true)
NEXTAUTH_SECRET=                 # NextAuth.js secret (required when PRIVATE_INSTANCE=true)
NEXTAUTH_URL=http://localhost:3000  # NextAuth.js URL (required in production)

# Two-Factor Authentication (Issue #18)
TWO_FA_ENCRYPTION_KEY=           # 256-bit hex key for 2FA secret encryption
```

## Commands

```bash
# Development
pnpm dev                       # Start dev server
pnpm build                     # Production build
pnpm test                      # Run tests
npx tsc --noEmit              # Type check

# Database
pnpm db:migrate               # Run migrations
pnpm db:studio                # Open Prisma Studio

# jj workflow
jj new                        # Start new feature
jj describe -m "feat: ..."    # Describe change
jj git push --change @        # Push to remote

# Docker/Podman (Issue #5)
cp container.env.example container.env  # Setup env
docker compose up -d          # Start with Docker
podman-compose up -d          # Or with Podman
docker compose logs -f        # View logs
```

## File Structure

```
src/
├── app/                      # Next.js app router pages
│   └── groups/
│       ├── [groupId]/        # Group-specific pages
│       └── create/           # Group creation
├── components/
│   ├── encryption-provider.tsx
│   ├── encryption-required.tsx
│   └── ui/                   # Shadcn UI components
├── lib/
│   ├── crypto.ts             # Crypto utilities
│   ├── encrypt-helpers.ts    # Encryption helpers
│   └── hooks/                # Custom hooks
└── trpc/                     # tRPC routers

# Docker/Podman files (Issue #5)
Dockerfile
compose.yaml
.dockerignore
container.env.example
scripts/build-image.sh
scripts/container-entrypoint.sh
```

## Contributing

1. Check existing issues or create new one
2. Create new jj change: `jj new`
3. Implement with tests
4. Update CLAUDE.md if needed
5. Run `pnpm test && npx tsc --noEmit`
6. Push and create PR: `jj git push --change @`
7. Request review
8. Merge after approval

## License

This project is a fork of [Spliit](https://github.com/spliit-app/spliit).
See LICENSE file for details.
