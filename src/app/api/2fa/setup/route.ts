/**
 * 2FA Setup API Endpoint
 *
 * This endpoint generates a new TOTP secret and backup codes for two-factor authentication.
 * The secret is stored encrypted in the database with twoFactorEnabled=false until verified.
 */

import { auth } from '@/lib/auth'
import {
  passwordChangeRequiredResponse,
  requiresTwoFactorResponse,
} from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import {
  encryptBackupCodes,
  encryptSecret,
  generateBackupCodes,
  generateQRCode,
  generateTOTPSecret,
} from '@/lib/two-factor'
import { NextResponse } from 'next/server'

export async function POST() {
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

    const userId = session.user.id
    const isAdmin = session.user.isAdmin
    const userEmail = session.user.email

    // Block re-init when 2FA is already enabled (Issue #140).
    // Use DB rather than session.user.twoFactorEnabled because the JWT may
    // be stale (e.g. the user disabled 2FA on another device).
    let alreadyEnabled = false
    if (isAdmin) {
      const admin = await prisma.admin.findUnique({
        where: { id: userId },
        select: { twoFactorEnabled: true },
      })
      alreadyEnabled = admin?.twoFactorEnabled ?? false
    } else {
      const whitelistUser = await prisma.whitelistUser.findUnique({
        where: { id: userId },
        select: { twoFactorEnabled: true },
      })
      alreadyEnabled = whitelistUser?.twoFactorEnabled ?? false
    }

    if (alreadyEnabled) {
      return NextResponse.json(
        { error: '2FA is already enabled. Please disable first.' },
        { status: 400 },
      )
    }

    // 2. Generate TOTP secret
    const { secret, otpauthUrl } = generateTOTPSecret(userEmail)

    // 3. Generate QR code
    const qrCode = await generateQRCode(otpauthUrl)

    // 4. Generate backup codes
    const backupCodes = generateBackupCodes()

    // 5. Encrypt secret and backup codes for storage
    const encryptedSecret = encryptSecret(secret)
    const encryptedBackupCodes = encryptBackupCodes(backupCodes)

    // 6. Store encrypted secret and backup codes (keep twoFactorEnabled=false)
    if (isAdmin) {
      await prisma.admin.update({
        where: { id: userId },
        data: {
          twoFactorSecret: encryptedSecret,
          twoFactorBackupCodes: encryptedBackupCodes,
          // Clear any stale verification timestamp from a previous setup (Issue #139)
          lastTwoFactorVerifiedAt: null,
          // Keep twoFactorEnabled=false until user verifies with a valid token
        },
      })
    } else {
      await prisma.whitelistUser.update({
        where: { id: userId },
        data: {
          twoFactorSecret: encryptedSecret,
          twoFactorBackupCodes: encryptedBackupCodes,
          // Clear any stale verification timestamp from a previous setup (Issue #139)
          lastTwoFactorVerifiedAt: null,
          // Keep twoFactorEnabled=false until user verifies with a valid token
        },
      })
    }

    // 7. Return setup data to display to user
    return NextResponse.json({
      qrCodeDataUrl: qrCode,
      secret,
      backupCodes,
    })
  } catch (error) {
    console.error('Error setting up 2FA:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
