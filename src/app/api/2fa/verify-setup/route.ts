/**
 * 2FA Verify Setup API (Issue #4)
 *
 * Verifies the TOTP token during 2FA setup and enables 2FA for the user.
 */

import { auth } from '@/lib/auth'
import {
  passwordChangeRequiredResponse,
  requiresTwoFactorResponse,
} from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import {
  checkRateLimitAsync,
  clearAttemptsAsync,
  recordFailedAttemptAsync,
} from '@/lib/rate-limit'
import { decryptSecret, verifyTOTP } from '@/lib/two-factor'
import { NextResponse } from 'next/server'

const RATE_LIMIT_PREFIX = '2fa-verify-setup:'

export async function POST(request: Request) {
  try {
    // 1. Check if user is authenticated
    const session = await auth()

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const twoFaResp = requiresTwoFactorResponse(session)
    if (twoFaResp) return twoFaResp

    const pwChangeResp = passwordChangeRequiredResponse(session)
    if (pwChangeResp) return pwChangeResp

    // 2. Accept { token } in request body
    const body = (await request.json()) as {
      token?: string
    }
    const { token } = body

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }

    // Validate token format (6 digits)
    if (!/^\d{6}$/.test(token)) {
      return NextResponse.json(
        { error: 'Token must be 6 digits' },
        { status: 400 },
      )
    }

    const userId = session.user.id
    const isAdmin = session.user.isAdmin

    // Check rate limit (5 attempts per 15 minutes per user)
    const rateLimitKey = `${RATE_LIMIT_PREFIX}${userId}`
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

    // 3. Get user's twoFactorSecret from database
    let twoFactorSecret: string | null = null
    let twoFactorEnabled: boolean = false

    if (isAdmin) {
      const admin = await prisma.admin.findUnique({
        where: { id: userId },
        select: { twoFactorSecret: true, twoFactorEnabled: true },
      })
      twoFactorSecret = admin?.twoFactorSecret ?? null
      twoFactorEnabled = admin?.twoFactorEnabled ?? false
    } else {
      const whitelistUser = await prisma.whitelistUser.findUnique({
        where: { id: userId },
        select: { twoFactorSecret: true, twoFactorEnabled: true },
      })
      twoFactorSecret = whitelistUser?.twoFactorSecret ?? null
      twoFactorEnabled = whitelistUser?.twoFactorEnabled ?? false
    }

    // Check if 2FA is already enabled
    if (twoFactorEnabled) {
      return NextResponse.json(
        { error: '2FA is already enabled' },
        { status: 400 },
      )
    }

    // Check if secret exists (setup must be initiated first)
    if (!twoFactorSecret) {
      return NextResponse.json(
        { error: '2FA setup not initiated. Please start setup first.' },
        { status: 400 },
      )
    }

    // 4. Decrypt the secret and verify the TOTP token
    let decryptedSecret: string
    try {
      decryptedSecret = decryptSecret(twoFactorSecret)
    } catch {
      return NextResponse.json(
        { error: 'Failed to decrypt 2FA secret' },
        { status: 500 },
      )
    }

    const isValidToken = verifyTOTP(decryptedSecret, token)

    if (!isValidToken) {
      await recordFailedAttemptAsync(rateLimitKey)
      return NextResponse.json(
        { error: 'Invalid token. Please try again.' },
        { status: 400 },
      )
    }

    // Clear rate limit attempts on successful verification
    await clearAttemptsAsync(rateLimitKey)

    // 5. If valid, set twoFactorEnabled=true and record the verification time
    // so the jwt callback's 5-minute window treats this setup as the latest
    // verification (Issue #139).
    const now = new Date()
    if (isAdmin) {
      await prisma.admin.update({
        where: { id: userId },
        data: { twoFactorEnabled: true, lastTwoFactorVerifiedAt: now },
      })
    } else {
      await prisma.whitelistUser.update({
        where: { id: userId },
        data: { twoFactorEnabled: true, lastTwoFactorVerifiedAt: now },
      })
    }

    // 6. Return { success: true }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error verifying 2FA setup:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
