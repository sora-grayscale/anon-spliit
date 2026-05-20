/**
 * Whitelist User Management API (Issue #4)
 *
 * POST hardening (Issue #176):
 *   - streaming body-size cap (4 KB) before JSON.parse, defending against
 *     `Content-Length` omission / under-declaration
 *   - zod schema for `email` (RFC 5321 max 254, format) and `name`
 *     (max 100, nullish for backward compatibility with `name || null`)
 *   - per-admin operation rate limit (60/h) keyed by the JWT subject
 *     (`session.user.id`), via the existing in-memory limiter from
 *     Issue #78. Memory-only / best-effort in multi-instance deployments.
 *
 * Rate-limit policy: pre-auth gates (private-instance, session/admin,
 * 2FA, password-change) and the CHECK itself never touch the limiter.
 * Once CHECK passes, every subsequent outcome — body-size 413, parse
 * 400, zod 400, duplicate 400, success 200, internal 500 — records one
 * attempt via the `finally` block.
 */

import { auth, isPrivateInstance } from '@/lib/auth'
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
import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'

/**
 * Generate a random initial password with sufficient entropy (Issue #48)
 * Uses 16 bytes (128 bits) of random data for cryptographic strength
 */
function generateInitialPassword(): string {
  return randomBytes(16).toString('base64url').slice(0, 20)
}

const MAX_BODY_BYTES = 4 * 1024 // 4 KB

/**
 * Streaming body reader with a hard byte-length cap.
 *
 * Reads `request.body` chunk by chunk and accumulates the total byte
 * length. When the accumulated size exceeds `maxBytes`, the reader is
 * cancelled mid-stream and `null` is returned — the caller must treat
 * this as 413. This is stricter than checking `Content-Length` because
 * clients may omit it (chunked transfer) or under-declare it.
 *
 * Returns `''` for a missing body. Throws (e.g. from `reader.read()`)
 * propagate to the caller's `try` so the outer `finally` still records
 * the rate-limit attempt (gate already passed).
 */
async function readRequestBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  const reader = request.body?.getReader()
  if (!reader) return ''

  const chunks: Uint8Array[] = []
  let total = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    // `releaseLock()` throws if the reader has already been cancelled in
    // some runtimes; swallow so the original control flow is preserved.
    try {
      reader.releaseLock()
    } catch {
      // ignore
    }
  }

  if (chunks.length === 0) return ''
  if (chunks.length === 1) return new TextDecoder().decode(chunks[0])

  const combined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(combined)
}

/**
 * Rate-limit key prefix for whitelist user creation. The full key is
 * `${RATE_LIMIT_PREFIX}${session.user.id}` — keyed by the authenticated
 * admin subject, not by request body fields, so it cannot be evaded by
 * varying the input email/name.
 */
const RATE_LIMIT_PREFIX = 'admin-whitelist:'
const RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour

const whitelistCreateSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().max(100).nullish(),
})

export async function POST(request: Request) {
  // 1. Private-instance gate.
  if (!isPrivateInstance()) {
    return NextResponse.json(
      { error: 'Private instance mode is not enabled' },
      { status: 400 },
    )
  }

  // 2. Session + admin gate.
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

  // 5. Rate-limit CHECK keyed by the admin subject.
  //    Gates 1-4 intentionally do not touch the limiter. After this
  //    point every outcome counts as one attempt via the finally below.
  const rateLimitKey = `${RATE_LIMIT_PREFIX}${session.user.id}`
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

  try {
    // 6. Streaming body-size cap.
    const rawBody = await readRequestBodyWithLimit(request, MAX_BODY_BYTES)
    if (rawBody === null) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }

    // 7. JSON parse (dedicated try so malformed bodies do not hit the
    //    outer-catch 500 path).
    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    // 8. zod schema (typeof string + email format + field-length caps).
    const result = whitelistCreateSchema.safeParse(parsed)
    if (!result.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    const { email } = result.data
    // Preserve historical `name || null` behavior — '', null, and
    // undefined all normalize to null.
    const name = result.data.name || null

    // 9. Duplicate checks.
    const existingUser = await prisma.whitelistUser.findUnique({
      where: { email },
    })
    if (existingUser) {
      return NextResponse.json(
        { error: 'User already in whitelist' },
        { status: 400 },
      )
    }

    const existingAdmin = await prisma.admin.findUnique({
      where: { email },
    })
    if (existingAdmin) {
      return NextResponse.json(
        { error: 'User is already an admin' },
        { status: 400 },
      )
    }

    // 10. Create whitelist user with initial password.
    const initialPassword = generateInitialPassword()
    const hashedPassword = await bcrypt.hash(initialPassword, 12)

    const user = await prisma.whitelistUser.create({
      data: {
        email,
        password: hashedPassword,
        name,
        mustChangePassword: true,
        addedById: session.user.id,
      },
    })

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      },
      initialPassword,
    })
  } catch (error) {
    console.error('Error adding whitelist user:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  } finally {
    recordOperationAttempt(rateLimitKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)
  }
}

export async function GET() {
  try {
    // Check if private instance mode is enabled
    if (!isPrivateInstance()) {
      return NextResponse.json(
        { error: 'Private instance mode is not enabled' },
        { status: 400 },
      )
    }

    // Check authentication
    const session = await auth()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const twoFaResp = requiresTwoFactorResponse(session)
    if (twoFaResp) return twoFaResp

    const pwChangeResp = passwordChangeRequiredResponse(session)
    if (pwChangeResp) return pwChangeResp

    const users = await prisma.whitelistUser.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ users })
  } catch (error) {
    console.error('Error fetching whitelist users:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
