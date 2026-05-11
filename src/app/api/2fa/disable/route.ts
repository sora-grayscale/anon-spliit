/**
 * 2FA Disable API Endpoint
 *
 * This endpoint disables two-factor authentication for the authenticated user.
 * Requires password verification and either TOTP token or backup code.
 */

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  checkRateLimit,
  clearAttempts,
  recordFailedAttempt,
} from '@/lib/rate-limit'
import {
  decryptBackupCodes,
  decryptSecret,
  normalizeToken,
  timingSafeCompare,
  verifyTOTP,
} from '@/lib/two-factor'
import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'

const RATE_LIMIT_PREFIX = '2fa-disable:'

export async function POST(request: Request) {
  try {
    // 1. Check if user is authenticated
    const session = await auth()

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Enforce password change before allowing 2FA operations
    if (session.user.mustChangePassword) {
      return NextResponse.json(
        { error: 'You must change your password before managing 2FA' },
        { status: 403 },
      )
    }

    const userId = session.user.id
    const isAdmin = session.user.isAdmin

    // Check rate limit (5 attempts per 15 minutes per user)
    const rateLimitKey = `${RATE_LIMIT_PREFIX}${userId}`
    const rateLimitResult = checkRateLimit(rateLimitKey)

    if (rateLimitResult.isLimited) {
      return NextResponse.json(
        {
          error: 'Too many disable attempts. Please try again later.',
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

    // 2. Accept { password, token } in request body
    const body = (await request.json()) as {
      password?: string
      token?: string
    }
    const { password, token } = body

    if (!password) {
      return NextResponse.json(
        { error: 'Password is required' },
        { status: 400 },
      )
    }

    if (!token) {
      return NextResponse.json(
        { error: 'Token or backup code is required' },
        { status: 400 },
      )
    }

    // Get user from database
    let userPassword: string | null = null
    let twoFactorSecret: string | null = null
    let twoFactorBackupCodes: string | null = null
    let twoFactorEnabled: boolean = false

    if (isAdmin) {
      const admin = await prisma.admin.findUnique({
        where: { id: userId },
        select: {
          password: true,
          twoFactorSecret: true,
          twoFactorBackupCodes: true,
          twoFactorEnabled: true,
        },
      })
      userPassword = admin?.password ?? null
      twoFactorSecret = admin?.twoFactorSecret ?? null
      twoFactorBackupCodes = admin?.twoFactorBackupCodes ?? null
      twoFactorEnabled = admin?.twoFactorEnabled ?? false
    } else {
      const whitelistUser = await prisma.whitelistUser.findUnique({
        where: { id: userId },
        select: {
          password: true,
          twoFactorSecret: true,
          twoFactorBackupCodes: true,
          twoFactorEnabled: true,
        },
      })
      userPassword = whitelistUser?.password ?? null
      twoFactorSecret = whitelistUser?.twoFactorSecret ?? null
      twoFactorBackupCodes = whitelistUser?.twoFactorBackupCodes ?? null
      twoFactorEnabled = whitelistUser?.twoFactorEnabled ?? false
    }

    if (!userPassword) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Check if 2FA is enabled
    if (!twoFactorEnabled) {
      return NextResponse.json({ error: '2FA is not enabled' }, { status: 400 })
    }

    // 3. Verify the password matches user's password
    const isValidPassword = await bcrypt.compare(password, userPassword)
    if (!isValidPassword) {
      recordFailedAttempt(rateLimitKey)
      return NextResponse.json(
        { error: 'Password is incorrect' },
        { status: 400 },
      )
    }

    // 4. Verify the TOTP token OR backup code
    let isValidToken = false
    let usedBackupCode = false

    // Check if secret exists
    if (!twoFactorSecret) {
      return NextResponse.json(
        { error: '2FA secret not found' },
        { status: 500 },
      )
    }

    // Try TOTP verification first (6 digits)
    if (/^\d{6}$/.test(token)) {
      try {
        const decryptedSecret = decryptSecret(twoFactorSecret)
        isValidToken = verifyTOTP(decryptedSecret, token)
      } catch {
        return NextResponse.json(
          { error: 'Failed to decrypt 2FA secret' },
          { status: 500 },
        )
      }
    }

    // If TOTP failed, try backup code (8 characters alphanumeric)
    if (!isValidToken && twoFactorBackupCodes) {
      try {
        const backupCodes = decryptBackupCodes(twoFactorBackupCodes)
        const normalizedToken = normalizeToken(token)

        // Use timing-safe comparison to check backup codes
        let codeIndex = -1
        for (let i = 0; i < backupCodes.length; i++) {
          if (timingSafeCompare(backupCodes[i], normalizedToken)) {
            codeIndex = i
            break
          }
        }

        if (codeIndex !== -1) {
          isValidToken = true
          usedBackupCode = true
          // Remove used backup code
          backupCodes.splice(codeIndex, 1)
        }
      } catch {
        // Backup code decryption failed, continue with invalid token
      }
    }

    if (!isValidToken) {
      recordFailedAttempt(rateLimitKey)
      return NextResponse.json(
        { error: 'Invalid token or backup code' },
        { status: 400 },
      )
    }

    // Clear rate limit attempts on successful verification
    clearAttempts(rateLimitKey)

    // 5. If verified, set twoFactorEnabled=false, twoFactorSecret=null, twoFactorBackupCodes=null
    if (isAdmin) {
      await prisma.admin.update({
        where: { id: userId },
        data: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorBackupCodes: null,
        },
      })
    } else {
      await prisma.whitelistUser.update({
        where: { id: userId },
        data: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorBackupCodes: null,
        },
      })
    }

    // 6. Return { success: true }
    return NextResponse.json({
      success: true,
      usedBackupCode,
    })
  } catch (error) {
    console.error('Error disabling 2FA:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
