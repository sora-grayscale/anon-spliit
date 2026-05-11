/**
 * @jest-environment node
 */

/**
 * Tests for `lastTwoFactorVerifiedAt` handling across 2FA REST routes
 * (Issue #139). Prevents the jwt callback's 5-minute window from treating
 * a stale verification timestamp as a fresh one after disable/re-setup.
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
  decryptSecret: jest.fn(() => 'SECRET'),
  decryptBackupCodes: jest.fn(() => ['CODE1']),
  normalizeToken: jest.fn((t: string) => t),
  timingSafeCompare: jest.fn(() => false),
  verifyTOTP: jest.fn(() => true),
}))

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => ({ isLimited: false })),
  recordFailedAttempt: jest.fn(),
  clearAttempts: jest.fn(),
}))

jest.mock('bcryptjs', () => ({
  compare: jest.fn(() => Promise.resolve(true)),
  hash: jest.fn(() => Promise.resolve('hashed')),
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
      twoFactorEnabled: true,
      requiresTwoFactor: false,
    },
    expires: '2099-01-01T00:00:00.000Z',
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('POST /api/2fa/disable — clears lastTwoFactorVerifiedAt (Issue #139)', () => {
  async function callDisable(isAdmin: boolean) {
    const { POST } = await import('@/app/api/2fa/disable/route')
    mockedAuth.mockResolvedValue(makeSession(isAdmin))
    const table = isAdmin ? mockedPrisma.admin : mockedPrisma.whitelistUser
    table.findUnique.mockResolvedValue({
      password: 'hashed',
      twoFactorSecret: 'enc-secret',
      twoFactorBackupCodes: 'enc-codes',
      twoFactorEnabled: true,
    })
    table.update.mockResolvedValue({})
    const req = new Request('http://localhost/api/2fa/disable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'p', token: '123456' }),
    })
    return POST(req)
  }

  it('clears lastTwoFactorVerifiedAt for admin', async () => {
    const res = await callDisable(true)
    expect(res.status).toBe(200)
    expect(mockedPrisma.admin.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1' },
        data: expect.objectContaining({
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorBackupCodes: null,
          lastTwoFactorVerifiedAt: null,
        }),
      }),
    )
  })

  it('clears lastTwoFactorVerifiedAt for whitelist user', async () => {
    const res = await callDisable(false)
    expect(res.status).toBe(200)
    expect(mockedPrisma.whitelistUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorBackupCodes: null,
          lastTwoFactorVerifiedAt: null,
        }),
      }),
    )
  })
})

describe('POST /api/2fa/setup — clears stale lastTwoFactorVerifiedAt (Issue #139)', () => {
  async function callSetup(isAdmin: boolean) {
    const { POST } = await import('@/app/api/2fa/setup/route')
    mockedAuth.mockResolvedValue(makeSession(isAdmin))
    const table = isAdmin ? mockedPrisma.admin : mockedPrisma.whitelistUser
    table.update.mockResolvedValue({})
    return POST()
  }

  it('clears lastTwoFactorVerifiedAt for admin', async () => {
    const res = await callSetup(true)
    expect(res.status).toBe(200)
    expect(mockedPrisma.admin.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1' },
        data: expect.objectContaining({
          lastTwoFactorVerifiedAt: null,
        }),
      }),
    )
  })

  it('clears lastTwoFactorVerifiedAt for whitelist user', async () => {
    const res = await callSetup(false)
    expect(res.status).toBe(200)
    expect(mockedPrisma.whitelistUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({
          lastTwoFactorVerifiedAt: null,
        }),
      }),
    )
  })
})

describe('POST /api/2fa/verify-setup — records lastTwoFactorVerifiedAt = now (Issue #139)', () => {
  async function callVerifySetup(isAdmin: boolean) {
    const { POST } = await import('@/app/api/2fa/verify-setup/route')
    mockedAuth.mockResolvedValue(makeSession(isAdmin))
    const table = isAdmin ? mockedPrisma.admin : mockedPrisma.whitelistUser
    table.findUnique.mockResolvedValue({
      twoFactorSecret: 'enc-secret',
      twoFactorEnabled: false,
    })
    table.update.mockResolvedValue({})
    const req = new Request('http://localhost/api/2fa/verify-setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: '123456' }),
    })
    return POST(req)
  }

  it('records lastTwoFactorVerifiedAt for admin', async () => {
    const res = await callVerifySetup(true)
    expect(res.status).toBe(200)
    const args = mockedPrisma.admin.update.mock.calls[0][0]
    expect(args.where).toEqual({ id: 'a1' })
    expect(args.data.twoFactorEnabled).toBe(true)
    expect(args.data.lastTwoFactorVerifiedAt).toBeInstanceOf(Date)
  })

  it('records lastTwoFactorVerifiedAt for whitelist user', async () => {
    const res = await callVerifySetup(false)
    expect(res.status).toBe(200)
    const args = mockedPrisma.whitelistUser.update.mock.calls[0][0]
    expect(args.where).toEqual({ id: 'u1' })
    expect(args.data.twoFactorEnabled).toBe(true)
    expect(args.data.lastTwoFactorVerifiedAt).toBeInstanceOf(Date)
  })
})
