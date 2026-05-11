/**
 * 2FA Setup API Endpoint
 *
 * This endpoint generates a new TOTP secret and backup codes for two-factor authentication.
 * The secret is stored encrypted in the database with twoFactorEnabled=false until verified.
 */

import { auth } from '@/lib/auth'
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

    const userId = session.user.id
    const isAdmin = session.user.isAdmin
    const userEmail = session.user.email

    // Check if 2FA is already enabled — prevent re-init overwrite
    const existingUser = isAdmin
      ? await prisma.admin.findUnique({ where: { id: userId } })
      : await prisma.whitelistUser.findUnique({ where: { id: userId } })
    if (existingUser?.twoFactorEnabled) {
      return NextResponse.json(
        { error: '2FA is already enabled. Disable it first before re-initializing.' },
        { status: 400 }
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
          // Keep twoFactorEnabled=false until user verifies with a valid token
        },
      })
    } else {
      await prisma.whitelistUser.update({
        where: { id: userId },
        data: {
          twoFactorSecret: encryptedSecret,
          twoFactorBackupCodes: encryptedBackupCodes,
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
