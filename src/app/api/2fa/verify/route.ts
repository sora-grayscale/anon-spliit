/**
 * 2FA Verify API Endpoint (Login Flow)
 *
 * Post-password / pre-2FA verification. Requires a NextAuth JWT session
 * issued by `authorize()` after password verification (Issue #4). The
 * endpoint is bound to the JWT subject:
 *
 *   - `body.email` must match `session.user.email` (client tamper check).
 *   - DB lookup uses `session.user.id` + `session.user.isAdmin` — the real
 *     subject pin. Email alone is insufficient because Admin and
 *     WhitelistUser tables are not cross-table email-unique at the DB
 *     constraint level.
 *
 * Failure of any pre-DB gate (private-instance, JSON parse, type, session,
 * email match, `requiresTwoFactor`, token format) returns early with no
 * side effects: no rate-limit store touch, no DB read/write, no failed
 * attempt recorded. The rate-limit key is also subject-id based, so an
 * attacker cannot lock out a third party (Issue #174).
 */

import { auth, isPrivateInstance } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  checkRateLimitAsync,
  clearAttemptsAsync,
  recordFailedAttemptAsync,
} from '@/lib/rate-limit'
import {
  decryptBackupCodes,
  decryptSecret,
  encryptBackupCodes,
  normalizeToken,
  timingSafeCompare,
  verifyTOTP,
} from '@/lib/two-factor'
import { NextResponse } from 'next/server'

// Backup code format: 8 alphanumeric characters (uppercase)
const BACKUP_CODE_REGEX = /^[A-Z0-9]{8}$/

// Rate-limit key prefix for 2FA verification (separate from login attempts).
// The full key is `${RATE_LIMIT_PREFIX}${session.user.id}` — keyed by the
// JWT subject id, NOT the request body email. This prevents an attacker
// from locking out a third party by submitting failed verifications under
// their email (Issue #174).
const RATE_LIMIT_PREFIX = '2fa-verify:'

export async function POST(request: Request) {
  try {
    // 1. Private-instance gate — endpoint must not exist on public mode.
    //    Placed before `request.json()` so even malformed bodies see 404.
    if (!isPrivateInstance()) {
      return new NextResponse(null, { status: 404 })
    }

    // 2. JSON parse — malformed bodies return 400 (not the outer-catch 500)
    //    and touch nothing else.
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    // 3. Type validation — `typeof string` is required; truthy is not enough
    //    for a security endpoint.
    const email = (body as { email?: unknown }).email
    const token = (body as { token?: unknown }).token
    if (typeof email !== 'string' || typeof token !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    // 4. Pre-2FA session must exist (issued by `authorize()` after password
    //    verification).
    const session = await auth()
    if (!session?.user?.email || !session.user.id) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 401 })
    }

    // 5. `body.email` must match the session subject (client tamper check).
    if (session.user.email !== email) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 401 })
    }

    // 6. Session must still require 2FA — if `requiresTwoFactor` is false
    //    the user has already completed verification for this login.
    if (!session.user.requiresTwoFactor) {
      return NextResponse.json({ error: 'Already verified' }, { status: 400 })
    }

    // 7. Token format — normalize then validate shape.
    const normalizedToken = normalizeToken(token)
    const isTOTPToken = /^\d{6}$/.test(normalizedToken)
    const isBackupCode = BACKUP_CODE_REGEX.test(normalizedToken)
    if (!isTOTPToken && !isBackupCode) {
      return NextResponse.json(
        { error: 'Token must be a 6-digit code or an 8-character backup code' },
        { status: 400 },
      )
    }

    // 8. Rate limit — keyed by the JWT subject id (NOT the body email).
    const rateLimitKey = `${RATE_LIMIT_PREFIX}${session.user.id}`
    const rateLimitResult = await checkRateLimitAsync(rateLimitKey)
    if (rateLimitResult.isLimited) {
      return NextResponse.json(
        {
          error: 'Too many verification attempts. Please try again later.',
          retryAfter: rateLimitResult.retryAfter,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimitResult.retryAfter || 60),
          },
        },
      )
    }

    // 9. DB lookup by session subject (id + isAdmin) — NOT by email.
    const isAdmin = session.user.isAdmin
    const user = isAdmin
      ? await prisma.admin.findUnique({
          where: { id: session.user.id },
          select: {
            id: true,
            twoFactorEnabled: true,
            twoFactorSecret: true,
            twoFactorBackupCodes: true,
          },
        })
      : await prisma.whitelistUser.findUnique({
          where: { id: session.user.id },
          select: {
            id: true,
            twoFactorEnabled: true,
            twoFactorSecret: true,
            twoFactorBackupCodes: true,
          },
        })

    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      // Generic error — do not reveal whether the subject exists or whether
      // 2FA is enabled (Issue #42).
      return NextResponse.json(
        { error: 'Invalid email or token' },
        { status: 401 },
      )
    }

    // 10. Verify the TOTP token OR check backup codes.
    let verified = false
    let usedBackupCode = false

    if (isTOTPToken) {
      let decryptedSecret: string
      try {
        decryptedSecret = decryptSecret(user.twoFactorSecret)
      } catch {
        return NextResponse.json(
          { error: 'Failed to decrypt 2FA secret' },
          { status: 500 },
        )
      }
      verified = verifyTOTP(decryptedSecret, normalizedToken)
    } else if (isBackupCode && user.twoFactorBackupCodes) {
      let backupCodes: string[]
      try {
        backupCodes = decryptBackupCodes(user.twoFactorBackupCodes)
      } catch {
        return NextResponse.json(
          { error: 'Failed to decrypt backup codes' },
          { status: 500 },
        )
      }

      let codeIndex = -1
      for (let i = 0; i < backupCodes.length; i++) {
        if (timingSafeCompare(backupCodes[i], normalizedToken)) {
          codeIndex = i
          break
        }
      }

      if (codeIndex !== -1) {
        verified = true
        usedBackupCode = true

        // 11a. Consume the used backup code (DB side effect #1).
        backupCodes.splice(codeIndex, 1)
        const encryptedBackupCodes = encryptBackupCodes(backupCodes)
        if (isAdmin) {
          await prisma.admin.update({
            where: { id: user.id },
            data: { twoFactorBackupCodes: encryptedBackupCodes },
          })
        } else {
          await prisma.whitelistUser.update({
            where: { id: user.id },
            data: { twoFactorBackupCodes: encryptedBackupCodes },
          })
        }
      }
    }

    if (!verified) {
      // 12. Verification failed — record the failed attempt for rate limiting.
      await recordFailedAttemptAsync(rateLimitKey)
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // 11b. Record server-side 2FA verification timestamp (Issue #123). The
    //      JWT callback clears `requiresTwoFactor` when this is within the
    //      5-minute freshness window.
    const now = new Date()
    if (isAdmin) {
      await prisma.admin.update({
        where: { id: user.id },
        data: { lastTwoFactorVerifiedAt: now },
      })
    } else {
      await prisma.whitelistUser.update({
        where: { id: user.id },
        data: { lastTwoFactorVerifiedAt: now },
      })
    }

    // 11c. Clear rate-limit attempts only AFTER DB side effects have
    //      completed — if a DB update fails, the rate-limit entry stays so
    //      retries are still throttled.
    await clearAttemptsAsync(rateLimitKey)

    return NextResponse.json({
      success: true,
      verified: true,
      usedBackupCode,
    })
  } catch (error) {
    console.error('Error verifying 2FA:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
