/**
 * Individual Whitelist User API (Issue #4)
 *
 * PATCH (password reset) and DELETE each carry a per-admin operation rate
 * limit (60/h) keyed by the JWT subject (`session.user.id`), mirroring the
 * POST route in `../route.ts`. The limiter is the process-local in-memory
 * limiter from Issue #78: best-effort only, NOT a cross-instance 60/h
 * guarantee on multi-instance / Vercel deployments.
 *
 * Rate-limit policy (mirrors POST): the pre-auth gates (private-instance,
 * session/admin+id, 2FA, password-change) and the CHECK itself do not consume
 * an attempt (CHECK reads the counter but reserves nothing), so a third party
 * cannot be locked out by failed requests. Once CHECK passes the slot is
 * reserved synchronously — before the DB/bcrypt work below — so a concurrent
 * burst cannot all observe `count<MAX` and bypass the cap. Every outcome after
 * that reservation (404 not-found, success, internal 500 from the DB/bcrypt
 * work) has therefore already consumed one attempt.
 */

import { auth, generateInitialPassword, isPrivateInstance } from '@/lib/auth'
import {
  passwordChangeRequiredResponse,
  requiresTwoFactorResponse,
} from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import {
  checkOperationRateLimit,
  recordOperationAttempt,
} from '@/lib/rate-limit'
import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'

const RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
// Distinct, non-colliding prefixes so reset and delete keep independent
// per-admin budgets. The full key is `${PREFIX}${session.user.id}` — keyed
// by the authenticated admin subject, not by the target userId.
const RESET_RATE_LIMIT_PREFIX = 'admin-whitelist-reset:'
const DELETE_RATE_LIMIT_PREFIX = 'admin-whitelist-delete:'

/**
 * Reset password for a whitelist user
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  // 1. Private-instance gate.
  if (!isPrivateInstance()) {
    return NextResponse.json(
      { error: 'Private instance mode is not enabled' },
      { status: 400 },
    )
  }

  // 2. Session + admin gate. Requiring `id` avoids a `...undefined` shared
  //    rate-limit bucket.
  const session = await auth()
  if (!session?.user?.isAdmin || !session.user.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 3. 2FA gate (mirrors tRPC publicProcedure / adminProcedure ordering).
  const twoFaResp = requiresTwoFactorResponse(session)
  if (twoFaResp) return twoFaResp

  // 4. Password-change gate.
  const pwChangeResp = passwordChangeRequiredResponse(session)
  if (pwChangeResp) return pwChangeResp

  // 5. Rate-limit CHECK keyed by the admin subject. Gates 1-4 and this CHECK
  //    do not consume an attempt, so a third party cannot be locked out via
  //    failed requests.
  const rateLimitKey = `${RESET_RATE_LIMIT_PREFIX}${session.user.id}`
  const limit = checkOperationRateLimit(
    rateLimitKey,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  )
  if (limit.isLimited) {
    return NextResponse.json(
      { error: 'Too many requests', retryAfter: limit.retryAfter },
      {
        status: 429,
        headers: {
          'Retry-After': String(
            limit.retryAfter || RATE_LIMIT_WINDOW_MS / 1000,
          ),
        },
      },
    )
  }

  // Reserve the limiter slot synchronously, before any await, so a concurrent
  // burst cannot all pass CHECK at low counts and bypass the cap.
  recordOperationAttempt(rateLimitKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)

  try {
    const { userId } = await params

    // Check if user exists
    const user = await prisma.whitelistUser.findUnique({
      where: { id: userId },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Generate new password
    const initialPassword = generateInitialPassword()
    const hashedPassword = await bcrypt.hash(initialPassword, 12)

    // Update user with new password. `passwordChangedAt` is bumped so
    // pre-existing JWTs are rejected by the iat acceptance check (Issue #135).
    // This is NOT a race-free revocation and it cuts both ways:
    //  - iat is second-granular while passwordChangedAt is millisecond, so a
    //    legitimate token minted in the same wall-clock second as the reset
    //    (iat <= passwordChangedAt) is also rejected — a rare transient logout.
    //  - a login whose authorize() started before this write (TOCTOU) can
    //    still mint a token that survives, since its iat may land after
    //    passwordChangedAt.
    await prisma.whitelistUser.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        mustChangePassword: true,
        passwordChangedAt: new Date(),
      },
    })

    return NextResponse.json({ initialPassword })
  } catch (error) {
    console.error('Error resetting password:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  // 1. Private-instance gate.
  if (!isPrivateInstance()) {
    return NextResponse.json(
      { error: 'Private instance mode is not enabled' },
      { status: 400 },
    )
  }

  // 2. Session + admin gate. Requiring `id` avoids a `...undefined` shared
  //    rate-limit bucket.
  const session = await auth()
  if (!session?.user?.isAdmin || !session.user.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 3. 2FA gate (mirrors tRPC publicProcedure / adminProcedure ordering).
  const twoFaResp = requiresTwoFactorResponse(session)
  if (twoFaResp) return twoFaResp

  // 4. Password-change gate.
  const pwChangeResp = passwordChangeRequiredResponse(session)
  if (pwChangeResp) return pwChangeResp

  // 5. Rate-limit CHECK keyed by the admin subject. Gates 1-4 and this CHECK
  //    do not consume an attempt, so a third party cannot be locked out via
  //    failed requests.
  const rateLimitKey = `${DELETE_RATE_LIMIT_PREFIX}${session.user.id}`
  const limit = checkOperationRateLimit(
    rateLimitKey,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  )
  if (limit.isLimited) {
    return NextResponse.json(
      { error: 'Too many requests', retryAfter: limit.retryAfter },
      {
        status: 429,
        headers: {
          'Retry-After': String(
            limit.retryAfter || RATE_LIMIT_WINDOW_MS / 1000,
          ),
        },
      },
    )
  }

  // Reserve the limiter slot synchronously, before any await, so a concurrent
  // burst cannot all pass CHECK at low counts and bypass the cap.
  recordOperationAttempt(rateLimitKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)

  try {
    const { userId } = await params

    // Check if user exists
    const user = await prisma.whitelistUser.findUnique({
      where: { id: userId },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Delete user
    await prisma.whitelistUser.delete({
      where: { id: userId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting whitelist user:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
