/**
 * @jest-environment node
 */

/**
 * Tests for blocking 2FA setup re-init when already enabled (Issue #140).
 * Prevents self-lockout caused by overwriting an active secret.
 */

jest.mock('@/lib/auth', () => ({
  auth: jest.fn(),
  isPrivateInstance: jest.fn(() => true),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    admin: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    whitelistUser: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}))

jest.mock('@/lib/two-factor', () => ({
  generateTOTPSecret: jest.fn(() => ({
    secret: 'SECRET',
    otpauthUrl: 'otpauth://totp/x',
  })),
  generateQRCode: jest.fn(() => Promise.resolve('data:image/png;base64,xxx')),
  generateBackupCodes: jest.fn(() => ['CODE1', 'CODE2']),
  encryptSecret: jest.fn(() => 'enc-secret'),
  encryptBackupCodes: jest.fn(() => 'enc-codes'),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mockedAuth = auth as jest.MockedFunction<typeof auth>
const mockedPrisma = prisma as unknown as {
  admin: { findUnique: jest.Mock; update: jest.Mock }
  whitelistUser: { findUnique: jest.Mock; update: jest.Mock }
}

function makeSession(isAdmin: boolean) {
  return {
    user: {
      id: isAdmin ? 'a1' : 'u1',
      email: isAdmin ? 'admin@example.com' : 'user@example.com',
      isAdmin,
      mustChangePassword: false,
      twoFactorEnabled: false,
      requiresTwoFactor: false,
    },
    expires: '2099-01-01T00:00:00.000Z',
  } as never
}

async function callSetup(isAdmin: boolean) {
  const { POST } = await import('@/app/api/2fa/setup/route')
  mockedAuth.mockResolvedValue(makeSession(isAdmin))
  return POST()
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('POST /api/2fa/setup — blocks re-init when already enabled (Issue #140)', () => {
  it('returns 400 and does not write when admin has 2FA enabled', async () => {
    mockedPrisma.admin.findUnique.mockResolvedValue({ twoFactorEnabled: true })
    const res = await callSetup(true)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toMatch(/already enabled/i)
    expect(mockedPrisma.admin.update).not.toHaveBeenCalled()
  })

  it('returns 400 and does not write when whitelist user has 2FA enabled', async () => {
    mockedPrisma.whitelistUser.findUnique.mockResolvedValue({
      twoFactorEnabled: true,
    })
    const res = await callSetup(false)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toMatch(/already enabled/i)
    expect(mockedPrisma.whitelistUser.update).not.toHaveBeenCalled()
  })

  it('proceeds normally when admin has 2FA disabled', async () => {
    mockedPrisma.admin.findUnique.mockResolvedValue({ twoFactorEnabled: false })
    mockedPrisma.admin.update.mockResolvedValue({})
    const res = await callSetup(true)
    expect(res.status).toBe(200)
    expect(mockedPrisma.admin.update).toHaveBeenCalled()
  })

  it('proceeds normally when whitelist user has 2FA disabled', async () => {
    mockedPrisma.whitelistUser.findUnique.mockResolvedValue({
      twoFactorEnabled: false,
    })
    mockedPrisma.whitelistUser.update.mockResolvedValue({})
    const res = await callSetup(false)
    expect(res.status).toBe(200)
    expect(mockedPrisma.whitelistUser.update).toHaveBeenCalled()
  })

  it('proceeds when admin record is missing (defaults to disabled)', async () => {
    mockedPrisma.admin.findUnique.mockResolvedValue(null)
    mockedPrisma.admin.update.mockResolvedValue({})
    const res = await callSetup(true)
    expect(res.status).toBe(200)
    expect(mockedPrisma.admin.update).toHaveBeenCalled()
  })
})
