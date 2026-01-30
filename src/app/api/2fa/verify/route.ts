/**
 * 2FA Verify API Endpoint (Login Flow)
 *
 * This endpoint verifies a TOTP token or backup code during login.
 * Called BEFORE full authentication - only requires email to identify the user.
 * Does not require session authentication since user hasn't completed login yet.
 */

import { prisma } from '@/lib/prisma'
import {
  checkRateLimit,
  clearAttempts,
  recordFailedAttempt,
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

// Rate limit key prefix for 2FA verification (separate from login attempts)
const RATE_LIMIT_PREFIX = '2fa-verify:'

export async function POST(request: Request) {
  try {
    // 1. Accept { email, token } in request body
    const body = (await request.json()) as {
      email?: string
      token?: string
    }
    const { email, token } = body

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }

    // Check rate limit before processing (5 attempts per minute per email)
    const rateLimitKey = `${RATE_LIMIT_PREFIX}${email}`
    const rateLimitResult = checkRateLimit(rateLimitKey)

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

    // Normalize token (trim whitespace, uppercase, remove non-alphanumeric)
    const normalizedToken = normalizeToken(token)

    // Determine if this is a TOTP token (6 digits) or backup code (8 alphanumeric)
    const isTOTPToken = /^\d{6}$/.test(normalizedToken)
    const isBackupCode = BACKUP_CODE_REGEX.test(normalizedToken)

    if (!isTOTPToken && !isBackupCode) {
      return NextResponse.json(
        { error: 'Token must be a 6-digit code or an 8-character backup code' },
        { status: 400 },
      )
    }

    // 2. Find user by email in Admin or WhitelistUser tables
    const admin = await prisma.admin.findUnique({
      where: { email },
      select: {
        id: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorBackupCodes: true,
      },
    })

    const whitelistUser = admin
      ? null
      : await prisma.whitelistUser.findUnique({
          where: { email },
          select: {
            id: true,
            twoFactorEnabled: true,
            twoFactorSecret: true,
            twoFactorBackupCodes: true,
          },
        })

    const user = admin || whitelistUser
    const isAdmin = !!admin

    if (!user) {
      // Don't reveal whether the email exists or not for security
      return NextResponse.json(
        { error: 'Invalid email or token' },
        { status: 401 },
      )
    }

    // 3. Check if twoFactorEnabled is true
    // Return generic error to prevent user enumeration (Issue #42)
    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      return NextResponse.json(
        { error: 'Invalid email or token' },
        { status: 401 },
      )
    }

    // 4. Decrypt twoFactorSecret and verify the TOTP token OR check backup codes
    let verified = false
    let usedBackupCode = false

    if (isTOTPToken) {
      // Verify TOTP token
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
      // Verify backup code
      let backupCodes: string[]
      try {
        backupCodes = decryptBackupCodes(user.twoFactorBackupCodes)
      } catch {
        return NextResponse.json(
          { error: 'Failed to decrypt backup codes' },
          { status: 500 },
        )
      }

      // Check if the backup code exists using timing-safe comparison
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

        // 5. If backup code is used, remove it from the list
        backupCodes.splice(codeIndex, 1)
        const encryptedBackupCodes = encryptBackupCodes(backupCodes)

        // Update the user's backup codes
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
      // Record failed attempt for rate limiting
      recordFailedAttempt(rateLimitKey)
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // Clear rate limit attempts on successful verification
    clearAttempts(rateLimitKey)

    // 6. Return { success: true, verified: true } on success
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
