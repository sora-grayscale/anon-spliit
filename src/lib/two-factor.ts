/**
 * Two-Factor Authentication (2FA) utilities
 *
 * This module provides server-side encryption for 2FA secrets and backup codes.
 * Uses AES-256-GCM for authenticated encryption.
 * The encryption key is stored in TWO_FA_ENCRYPTION_KEY environment variable.
 */

import * as OTPAuth from 'otpauth'
import QRCode from 'qrcode'
import { env } from './env'

// ============================================================
// Constants
// ============================================================

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // 96-bit IV for GCM (recommended)
const AUTH_TAG_LENGTH = 16 // 128-bit auth tag
const BACKUP_CODE_LENGTH = 8
const BACKUP_CODE_COUNT = 10

// App name for TOTP
const APP_NAME = 'anon-spliit'

// TOTP Algorithm - configurable via environment variable (Issue #49)
// Default to SHA1 for compatibility with most authenticator apps
// SHA256 provides better security but may not work with all apps
const TOTP_ALGORITHM = env.TOTP_ALGORITHM || 'SHA1'

// ============================================================
// Key Management
// ============================================================

/**
 * Get the encryption key from environment variable
 * @returns 256-bit key as Buffer
 * @throws Error if TWO_FA_ENCRYPTION_KEY is not set
 */
function getEncryptionKey(): Buffer {
  const keyHex = env.TWO_FA_ENCRYPTION_KEY
  if (!keyHex) {
    throw new Error(
      'TWO_FA_ENCRYPTION_KEY environment variable is not set. ' +
        'Generate a 256-bit key with: openssl rand -hex 32',
    )
  }

  const key = Buffer.from(keyHex, 'hex')
  if (key.length !== 32) {
    throw new Error(
      'TWO_FA_ENCRYPTION_KEY must be exactly 256 bits (32 bytes). ' +
        `Got ${key.length} bytes.`,
    )
  }

  return key
}

// ============================================================
// Encryption/Decryption (AES-256-GCM)
// ============================================================

/**
 * Encrypt a secret using AES-256-GCM
 * Returns base64-encoded string containing: IV (12 bytes) + ciphertext + authTag (16 bytes)
 *
 * @param secret - The plaintext secret to encrypt
 * @returns Base64-encoded encrypted data
 */
export function encryptSecret(secret: string): string {
  // Dynamic import for Node.js crypto (server-side only)

  const crypto = require('crypto')

  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  })

  const encrypted = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ])

  const authTag = cipher.getAuthTag()

  // Combine: IV + ciphertext + authTag
  const combined = Buffer.concat([iv, encrypted, authTag])

  return combined.toString('base64')
}

/**
 * Decrypt a secret using AES-256-GCM
 *
 * @param encryptedData - Base64-encoded encrypted data
 * @returns Decrypted plaintext secret
 * @throws Error if decryption fails (invalid key, tampered data, etc.)
 */
export function decryptSecret(encryptedData: string): string {
  // Dynamic import for Node.js crypto (server-side only)

  const crypto = require('crypto')

  const key = getEncryptionKey()
  const combined = Buffer.from(encryptedData, 'base64')

  // Extract components
  const iv = combined.subarray(0, IV_LENGTH)
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH)
  const ciphertext = combined.subarray(
    IV_LENGTH,
    combined.length - AUTH_TAG_LENGTH,
  )

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  })

  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}

// ============================================================
// Token Normalization
// ============================================================

/**
 * Normalize a 2FA token (TOTP or backup code)
 * - Trims whitespace
 * - Converts to uppercase
 * - Removes non-alphanumeric characters (for backup codes with dashes)
 *
 * @param token - The token to normalize
 * @returns Normalized token
 */
export function normalizeToken(token: string): string {
  return token
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

// ============================================================
// Backup Codes
// ============================================================

/**
 * Generate secure backup codes using rejection sampling
 * Each code is 8 characters (alphanumeric, uppercase)
 * Uses rejection sampling to ensure uniform distribution
 *
 * @returns Array of 10 backup codes
 */
export function generateBackupCodes(): string[] {
  const crypto = require('crypto')

  const codes: string[] = []
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  // Calculate maximum valid byte value for uniform distribution
  const maxValid = Math.floor(256 / charset.length) * charset.length

  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    let code = ''
    for (let j = 0; j < BACKUP_CODE_LENGTH; j++) {
      let randomValue: number
      // Rejection sampling: keep generating until we get a valid value
      do {
        randomValue = crypto.randomBytes(1)[0]
      } while (randomValue >= maxValid)
      code += charset[randomValue % charset.length]
    }
    codes.push(code)
  }

  return codes
}

/**
 * Encrypt backup codes as JSON array
 *
 * @param codes - Array of backup codes
 * @returns Base64-encoded encrypted JSON
 */
export function encryptBackupCodes(codes: string[]): string {
  const json = JSON.stringify(codes)
  return encryptSecret(json)
}

/**
 * Decrypt backup codes from encrypted JSON
 *
 * @param encrypted - Base64-encoded encrypted JSON
 * @returns Array of backup codes
 */
export function decryptBackupCodes(encrypted: string): string[] {
  const json = decryptSecret(encrypted)
  return JSON.parse(json) as string[]
}

/**
 * Timing-safe string comparison to prevent timing attacks
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns true if strings are equal, false otherwise
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const crypto = require('crypto')
  if (a.length !== b.length) return false
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  return crypto.timingSafeEqual(bufA, bufB)
}

// ============================================================
// TOTP (Time-based One-Time Password)
// ============================================================

/**
 * Generate a new TOTP secret and otpauth URL
 *
 * @param userIdentifier - User identifier (email, username, or account ID)
 * @returns Object containing base32-encoded secret and otpauth URL
 */
export function generateTOTPSecret(userIdentifier: string = 'user'): {
  secret: string
  otpauthUrl: string
} {
  // Create a new TOTP instance with random secret
  const totp = new OTPAuth.TOTP({
    issuer: APP_NAME,
    label: userIdentifier,
    algorithm: TOTP_ALGORITHM,
    digits: 6,
    period: 30,
  })

  return {
    secret: totp.secret.base32,
    otpauthUrl: totp.toString(),
  }
}

/**
 * Verify a TOTP token against a secret
 *
 * @param secret - Base32-encoded TOTP secret
 * @param token - 6-digit token to verify
 * @returns true if token is valid, false otherwise
 */
export function verifyTOTP(secret: string, token: string): boolean {
  try {
    const totp = new OTPAuth.TOTP({
      issuer: APP_NAME,
      algorithm: TOTP_ALGORITHM,
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    })

    // validate returns null if invalid, or the delta (time step difference) if valid
    // window: 1 allows for 1 time step before/after (30 seconds tolerance)
    const delta = totp.validate({ token, window: 1 })

    return delta !== null
  } catch {
    return false
  }
}

// ============================================================
// QR Code Generation
// ============================================================

/**
 * Generate a QR code as a data URL for the otpauth URL
 *
 * @param otpauthUrl - The otpauth:// URL to encode
 * @returns Promise resolving to a data URL (image/png;base64,...)
 */
export async function generateQRCode(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl, {
    errorCorrectionLevel: 'M',
    type: 'image/png',
    width: 256,
    margin: 2,
  })
}
