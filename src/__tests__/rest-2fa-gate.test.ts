/**
 * @jest-environment node
 */

/**
 * Route-level regression tests for the requiresTwoFactor gate (Issue #166).
 *
 * Verifies that REST endpoints return 401 `Two-factor authentication required`
 * when the session has not yet completed 2FA for the current login. Covers
 * representative endpoints from each affected area: 2FA management
 * (setup/disable) and admin whitelist (POST/GET). The remaining gated
 * endpoints (verify-setup, change-password, whitelist PATCH/DELETE) share
 * the same helper call and are exercised by the helper's own unit tests in
 * `src/lib/auth-helpers.test.ts`.
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
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    whitelistUser: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

// Mirror `two-factor-last-verified.test.ts`: stub server-only modules so
// importing the route handlers doesn't pull in crypto/qrcode/timer
// side-effects during test setup.
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
  decryptBackupCodes: jest.fn(() => ['CODE1', 'CODE2']),
  normalizeToken: jest.fn((t: string) => t),
  timingSafeCompare: jest.fn(() => false),
  verifyTOTP: jest.fn(() => false),
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
  admin: { findUnique: jest.Mock; findMany: jest.Mock; create: jest.Mock }
  whitelistUser: {
    findUnique: jest.Mock
    findMany: jest.Mock
    create: jest.Mock
  }
}

function makeSession({
  isAdmin = false,
  requiresTwoFactor = false,
}: {
  isAdmin?: boolean
  requiresTwoFactor?: boolean
} = {}) {
  return {
    user: {
      id: isAdmin ? 'a1' : 'u1',
      email: isAdmin ? 'admin@example.com' : 'user@example.com',
      isAdmin,
      mustChangePassword: false,
      twoFactorEnabled: true,
      requiresTwoFactor,
    },
    expires: '2099-01-01T00:00:00.000Z',
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('REST endpoints — requiresTwoFactor gate (Issue #166)', () => {
  it('POST /api/2fa/setup returns 401 when requiresTwoFactor is true', async () => {
    mockedAuth.mockResolvedValue(makeSession({ requiresTwoFactor: true }))
    const { POST } = await import('@/app/api/2fa/setup/route')
    const res = await POST()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: 'Two-factor authentication required',
    })
    // Should short-circuit before touching the database.
    expect(mockedPrisma.admin.findUnique).not.toHaveBeenCalled()
    expect(mockedPrisma.whitelistUser.findUnique).not.toHaveBeenCalled()
  })

  it('POST /api/2fa/disable returns 401 when requiresTwoFactor is true', async () => {
    mockedAuth.mockResolvedValue(makeSession({ requiresTwoFactor: true }))
    const { POST } = await import('@/app/api/2fa/disable/route')
    const request = new Request('http://localhost/api/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({ password: 'irrelevant', token: '123456' }),
    })
    const res = await POST(request)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: 'Two-factor authentication required',
    })
    expect(mockedPrisma.admin.findUnique).not.toHaveBeenCalled()
    expect(mockedPrisma.whitelistUser.findUnique).not.toHaveBeenCalled()
  })

  it('POST /api/admin/whitelist returns 401 when admin requiresTwoFactor is true', async () => {
    mockedAuth.mockResolvedValue(
      makeSession({ isAdmin: true, requiresTwoFactor: true }),
    )
    const { POST } = await import('@/app/api/admin/whitelist/route')
    const request = new Request('http://localhost/api/admin/whitelist', {
      method: 'POST',
      body: JSON.stringify({ email: 'new@example.com' }),
    })
    const res = await POST(request)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: 'Two-factor authentication required',
    })
    expect(mockedPrisma.whitelistUser.create).not.toHaveBeenCalled()
  })

  it('GET /api/admin/whitelist returns 401 when admin requiresTwoFactor is true', async () => {
    mockedAuth.mockResolvedValue(
      makeSession({ isAdmin: true, requiresTwoFactor: true }),
    )
    const { GET } = await import('@/app/api/admin/whitelist/route')
    const res = await GET()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: 'Two-factor authentication required',
    })
    expect(mockedPrisma.whitelistUser.findMany).not.toHaveBeenCalled()
  })
})
