/**
 * @jest-environment node
 */

/**
 * Subject-binding tests for `/api/2fa/verify` (Issue #174).
 *
 * Verifies the 8-stage gate (`isPrivateInstance` → JSON parse → type
 * validation → `auth()` session → email match → `requiresTwoFactor` →
 * token format → subject-id rate limit) returns early with NO side
 * effects on failure, and that DB lookup goes through `session.user.id` +
 * `session.user.isAdmin` (NOT the body email) on the happy path.
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
  decryptSecret: jest.fn(() => 'DECRYPTED_SECRET'),
  decryptBackupCodes: jest.fn(() => ['CODE1', 'CODE2']),
  encryptBackupCodes: jest.fn(() => 'enc-codes'),
  normalizeToken: jest.fn((t: string) => t),
  timingSafeCompare: jest.fn(() => false),
  verifyTOTP: jest.fn(() => false),
}))

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimitAsync: jest.fn(() =>
    Promise.resolve({ isLimited: false, remainingAttempts: 5 }),
  ),
  recordFailedAttemptAsync: jest.fn(() => Promise.resolve()),
  clearAttemptsAsync: jest.fn(() => Promise.resolve()),
}))

import { auth, isPrivateInstance } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  checkRateLimitAsync,
  clearAttemptsAsync,
  recordFailedAttemptAsync,
} from '@/lib/rate-limit'
import { timingSafeCompare, verifyTOTP } from '@/lib/two-factor'

const mockedAuth = auth as jest.MockedFunction<typeof auth>
const mockedIsPrivateInstance = isPrivateInstance as jest.MockedFunction<
  typeof isPrivateInstance
>
const mockedCheckRateLimitAsync = checkRateLimitAsync as jest.MockedFunction<
  typeof checkRateLimitAsync
>
const mockedRecordFailedAttemptAsync =
  recordFailedAttemptAsync as jest.MockedFunction<
    typeof recordFailedAttemptAsync
  >
const mockedClearAttemptsAsync = clearAttemptsAsync as jest.MockedFunction<
  typeof clearAttemptsAsync
>
const mockedVerifyTOTP = verifyTOTP as jest.MockedFunction<typeof verifyTOTP>
const mockedTimingSafeCompare = timingSafeCompare as jest.MockedFunction<
  typeof timingSafeCompare
>
const mockedPrisma = prisma as unknown as {
  admin: { findUnique: jest.Mock; update: jest.Mock }
  whitelistUser: { findUnique: jest.Mock; update: jest.Mock }
}

function makeSession({
  id = 'u1',
  email = 'user@example.com',
  isAdmin = false,
  requiresTwoFactor = true,
}: {
  id?: string
  email?: string
  isAdmin?: boolean
  requiresTwoFactor?: boolean
} = {}) {
  return {
    user: {
      id,
      email,
      isAdmin,
      mustChangePassword: false,
      twoFactorEnabled: true,
      requiresTwoFactor,
    },
    expires: '2099-01-01T00:00:00.000Z',
  } as never
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/2fa/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function expectZeroSideEffects() {
  expect(mockedPrisma.admin.findUnique).not.toHaveBeenCalled()
  expect(mockedPrisma.admin.update).not.toHaveBeenCalled()
  expect(mockedPrisma.whitelistUser.findUnique).not.toHaveBeenCalled()
  expect(mockedPrisma.whitelistUser.update).not.toHaveBeenCalled()
  expect(mockedRecordFailedAttemptAsync).not.toHaveBeenCalled()
  expect(mockedClearAttemptsAsync).not.toHaveBeenCalled()
}

beforeEach(() => {
  jest.clearAllMocks()
  mockedIsPrivateInstance.mockReturnValue(true)
  mockedCheckRateLimitAsync.mockResolvedValue({
    isLimited: false,
    remainingAttempts: 5,
  })
  mockedVerifyTOTP.mockReturnValue(false)
  mockedTimingSafeCompare.mockReturnValue(false)
})

describe('POST /api/2fa/verify — subject binding (Issue #174)', () => {
  it('1: returns 404 when private instance is disabled (no side effects, auth not called)', async () => {
    mockedIsPrivateInstance.mockReturnValue(false)
    const { POST } = await import('@/app/api/2fa/verify/route')
    const res = await POST(
      makeRequest({ email: 'u@example.com', token: '123456' }),
    )
    expect(res.status).toBe(404)
    expect(mockedAuth).not.toHaveBeenCalled()
    expect(mockedCheckRateLimitAsync).not.toHaveBeenCalled()
    expectZeroSideEffects()
  })

  it('2: returns 400 on malformed JSON (no side effects)', async () => {
    const { POST } = await import('@/app/api/2fa/verify/route')
    const req = new Request('http://localhost/api/2fa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid request' })
    expect(mockedAuth).not.toHaveBeenCalled()
    expect(mockedCheckRateLimitAsync).not.toHaveBeenCalled()
    expectZeroSideEffects()
  })

  it('3: returns 400 when body.email is not a string', async () => {
    const { POST } = await import('@/app/api/2fa/verify/route')
    const res = await POST(makeRequest({ email: 123, token: '123456' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid request' })
    expect(mockedAuth).not.toHaveBeenCalled()
    expect(mockedCheckRateLimitAsync).not.toHaveBeenCalled()
    expectZeroSideEffects()
  })

  it('4: returns 400 when body.token is not a string', async () => {
    const { POST } = await import('@/app/api/2fa/verify/route')
    const res = await POST(
      makeRequest({ email: 'u@example.com', token: 123456 }),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid request' })
    expect(mockedAuth).not.toHaveBeenCalled()
    expect(mockedCheckRateLimitAsync).not.toHaveBeenCalled()
    expectZeroSideEffects()
  })

  it('5: returns 401 when there is no session', async () => {
    mockedAuth.mockResolvedValue(null as never)
    const { POST } = await import('@/app/api/2fa/verify/route')
    const res = await POST(
      makeRequest({ email: 'u@example.com', token: '123456' }),
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid request' })
    expect(mockedCheckRateLimitAsync).not.toHaveBeenCalled()
    expectZeroSideEffects()
  })

  it('6: returns 401 when session email does not match body email', async () => {
    mockedAuth.mockResolvedValue(makeSession({ email: 'real@example.com' }))
    const { POST } = await import('@/app/api/2fa/verify/route')
    const res = await POST(
      makeRequest({ email: 'attacker@example.com', token: '123456' }),
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid request' })
    expect(mockedCheckRateLimitAsync).not.toHaveBeenCalled()
    expectZeroSideEffects()
  })

  it('7: returns 400 Already verified when requiresTwoFactor is false', async () => {
    mockedAuth.mockResolvedValue(
      makeSession({ email: 'u@example.com', requiresTwoFactor: false }),
    )
    const { POST } = await import('@/app/api/2fa/verify/route')
    const res = await POST(
      makeRequest({ email: 'u@example.com', token: '123456' }),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Already verified' })
    expect(mockedCheckRateLimitAsync).not.toHaveBeenCalled()
    expectZeroSideEffects()
  })

  it('8: returns 400 when token format is invalid (rate-limit untouched)', async () => {
    mockedAuth.mockResolvedValue(makeSession({ email: 'u@example.com' }))
    const { POST } = await import('@/app/api/2fa/verify/route')
    const res = await POST(
      makeRequest({ email: 'u@example.com', token: 'bad-format' }),
    )
    expect(res.status).toBe(400)
    expect(mockedCheckRateLimitAsync).not.toHaveBeenCalled()
    expectZeroSideEffects()
  })

  it('9: returns 429 when rate limited (no DB side effects)', async () => {
    mockedAuth.mockResolvedValue(makeSession({ email: 'u@example.com' }))
    mockedCheckRateLimitAsync.mockResolvedValue({
      isLimited: true,
      retryAfter: 600,
    })
    const { POST } = await import('@/app/api/2fa/verify/route')
    const res = await POST(
      makeRequest({ email: 'u@example.com', token: '123456' }),
    )
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('600')
    expect(mockedPrisma.admin.findUnique).not.toHaveBeenCalled()
    expect(mockedPrisma.whitelistUser.findUnique).not.toHaveBeenCalled()
    expect(mockedRecordFailedAttemptAsync).not.toHaveBeenCalled()
    expect(mockedClearAttemptsAsync).not.toHaveBeenCalled()
  })

  it('10: happy TOTP for Admin uses admin.findUnique by id and clears attempts', async () => {
    mockedAuth.mockResolvedValue(
      makeSession({ id: 'a1', email: 'admin@example.com', isAdmin: true }),
    )
    mockedPrisma.admin.findUnique.mockResolvedValue({
      id: 'a1',
      twoFactorEnabled: true,
      twoFactorSecret: 'enc-secret',
      twoFactorBackupCodes: null,
    })
    mockedVerifyTOTP.mockReturnValue(true)
    const { POST } = await import('@/app/api/2fa/verify/route')
    const res = await POST(
      makeRequest({ email: 'admin@example.com', token: '123456' }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      success: true,
      verified: true,
      usedBackupCode: false,
    })
    expect(mockedPrisma.admin.findUnique).toHaveBeenCalledWith({
      where: { id: 'a1' },
      select: {
        id: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorBackupCodes: true,
      },
    })
    expect(mockedPrisma.admin.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1' },
        data: expect.objectContaining({
          lastTwoFactorVerifiedAt: expect.any(Date),
        }),
      }),
    )
    expect(mockedPrisma.whitelistUser.findUnique).not.toHaveBeenCalled()
    expect(mockedPrisma.whitelistUser.update).not.toHaveBeenCalled()
    expect(mockedClearAttemptsAsync).toHaveBeenCalledWith('2fa-verify:a1')
    expect(mockedRecordFailedAttemptAsync).not.toHaveBeenCalled()
  })

  it('11: happy backup code for WhitelistUser splices + updates + clears attempts', async () => {
    mockedAuth.mockResolvedValue(
      makeSession({ id: 'u1', email: 'user@example.com', isAdmin: false }),
    )
    mockedPrisma.whitelistUser.findUnique.mockResolvedValue({
      id: 'u1',
      twoFactorEnabled: true,
      twoFactorSecret: 'enc-secret',
      twoFactorBackupCodes: 'enc-codes',
    })
    // First timingSafeCompare returns true → codeIndex=0 → consume.
    mockedTimingSafeCompare.mockImplementationOnce(() => true)
    const { POST } = await import('@/app/api/2fa/verify/route')
    const res = await POST(
      makeRequest({ email: 'user@example.com', token: 'ABCD1234' }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      success: true,
      verified: true,
      usedBackupCode: true,
    })
    expect(mockedPrisma.whitelistUser.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: {
        id: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorBackupCodes: true,
      },
    })
    // Two updates: backup-codes splice then lastTwoFactorVerifiedAt.
    expect(mockedPrisma.whitelistUser.update).toHaveBeenCalledTimes(2)
    expect(mockedPrisma.whitelistUser.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { twoFactorBackupCodes: 'enc-codes' },
    })
    expect(mockedPrisma.whitelistUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({
          lastTwoFactorVerifiedAt: expect.any(Date),
        }),
      }),
    )
    expect(mockedPrisma.admin.findUnique).not.toHaveBeenCalled()
    expect(mockedPrisma.admin.update).not.toHaveBeenCalled()
    expect(mockedClearAttemptsAsync).toHaveBeenCalledWith('2fa-verify:u1')
    expect(mockedRecordFailedAttemptAsync).not.toHaveBeenCalled()
  })

  it('12: returns 401 Invalid token when verify fails (recordFailedAttempt called, no updates)', async () => {
    mockedAuth.mockResolvedValue(
      makeSession({ id: 'u1', email: 'user@example.com', isAdmin: false }),
    )
    mockedPrisma.whitelistUser.findUnique.mockResolvedValue({
      id: 'u1',
      twoFactorEnabled: true,
      twoFactorSecret: 'enc-secret',
      twoFactorBackupCodes: null,
    })
    mockedVerifyTOTP.mockReturnValue(false)
    const { POST } = await import('@/app/api/2fa/verify/route')
    const res = await POST(
      makeRequest({ email: 'user@example.com', token: '000000' }),
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid token' })
    expect(mockedRecordFailedAttemptAsync).toHaveBeenCalledWith('2fa-verify:u1')
    expect(mockedPrisma.whitelistUser.update).not.toHaveBeenCalled()
    expect(mockedPrisma.admin.update).not.toHaveBeenCalled()
    expect(mockedClearAttemptsAsync).not.toHaveBeenCalled()
  })
})
