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
      updateMany: jest.fn(),
    },
    whitelistUser: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
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
  admin: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock }
  whitelistUser: {
    findUnique: jest.Mock
    update: jest.Mock
    updateMany: jest.Mock
  }
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
  // The route requires the body subject ({subjectId, subjectIsAdmin}) to
  // match the session subject; default to the default session's subject so
  // tests only override what they exercise.
  const payload =
    typeof body === 'string'
      ? body
      : JSON.stringify({
          subjectId: 'u1',
          subjectIsAdmin: false,
          ...(body as Record<string, unknown>),
        })
  return new Request('http://localhost/api/2fa/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  })
}

function expectZeroSideEffects() {
  expect(mockedPrisma.admin.findUnique).not.toHaveBeenCalled()
  expect(mockedPrisma.admin.update).not.toHaveBeenCalled()
  expect(mockedPrisma.admin.updateMany).not.toHaveBeenCalled()
  expect(mockedPrisma.whitelistUser.findUnique).not.toHaveBeenCalled()
  expect(mockedPrisma.whitelistUser.update).not.toHaveBeenCalled()
  expect(mockedPrisma.whitelistUser.updateMany).not.toHaveBeenCalled()
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

  it('6b: returns 401 when the body subject id does not match the session (no side effects)', async () => {
    // Same email can exist on both the Admin and WhitelistUser tables: an
    // outcome must never be attributable to a subject the session does not
    // prove.
    mockedAuth.mockResolvedValue(makeSession({ email: 'u@example.com' }))
    const { POST } = await import('@/app/api/2fa/verify/route')
    const res = await POST(
      makeRequest({
        email: 'u@example.com',
        token: '123456',
        subjectId: 'someone-else',
      }),
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid request' })
    expect(mockedCheckRateLimitAsync).not.toHaveBeenCalled()
    expectZeroSideEffects()
  })

  it('6c: returns 401 when the body subject role does not match the session', async () => {
    mockedAuth.mockResolvedValue(makeSession({ email: 'u@example.com' }))
    const { POST } = await import('@/app/api/2fa/verify/route')
    const res = await POST(
      makeRequest({
        email: 'u@example.com',
        token: '123456',
        subjectIsAdmin: true,
      }),
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid request' })
    expect(mockedCheckRateLimitAsync).not.toHaveBeenCalled()
    expectZeroSideEffects()
  })

  it('6d: returns 400 when the body subject fields are missing or mistyped', async () => {
    const { POST } = await import('@/app/api/2fa/verify/route')
    const res = await POST(
      makeRequest({
        email: 'u@example.com',
        token: '123456',
        subjectId: 42,
      }),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid request' })
    expect(mockedAuth).not.toHaveBeenCalled()
    expectZeroSideEffects()
  })

  it('7: returns 400 Already verified (machine-readable code) when requiresTwoFactor is false', async () => {
    mockedAuth.mockResolvedValue(
      makeSession({ email: 'u@example.com', requiresTwoFactor: false }),
    )
    const { POST } = await import('@/app/api/2fa/verify/route')
    const res = await POST(
      makeRequest({ email: 'u@example.com', token: '123456' }),
    )
    expect(res.status).toBe(400)
    // The code lets the client treat this as the success it is; subject
    // match is guaranteed because the check above (6b/6c) runs first.
    expect(await res.json()).toEqual({
      error: 'Already verified',
      code: 'ALREADY_VERIFIED',
    })
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
      makeRequest({
        email: 'admin@example.com',
        token: '123456',
        subjectId: 'a1',
        subjectIsAdmin: true,
      }),
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
        lastTwoFactorVerifiedAt: true,
      },
    })
    // TOTP path: exactly one write, timestamp only (no backup-code field).
    expect(mockedPrisma.admin.update).toHaveBeenCalledTimes(1)
    expect(mockedPrisma.admin.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { lastTwoFactorVerifiedAt: expect.any(Date) },
    })
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
      lastTwoFactorVerifiedAt: null,
    })
    // First timingSafeCompare returns true → codeIndex=0 → consume.
    mockedTimingSafeCompare.mockImplementationOnce(() => true)
    mockedPrisma.whitelistUser.updateMany.mockResolvedValue({ count: 1 })
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
        lastTwoFactorVerifiedAt: true,
      },
    })
    // Single CAS write: the WHERE pins the exact blob this attempt decoded,
    // and code consumption + verification timestamp commit together — a
    // partial commit would burn the code without granting the 5-minute
    // session-refresh window the client needs to complete the sign-in.
    expect(mockedPrisma.whitelistUser.updateMany).toHaveBeenCalledTimes(1)
    expect(mockedPrisma.whitelistUser.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', twoFactorBackupCodes: 'enc-codes' },
      data: {
        twoFactorBackupCodes: 'enc-codes',
        lastTwoFactorVerifiedAt: expect.any(Date),
      },
    })
    expect(mockedPrisma.whitelistUser.update).not.toHaveBeenCalled()
    expect(mockedPrisma.admin.findUnique).not.toHaveBeenCalled()
    expect(mockedPrisma.admin.updateMany).not.toHaveBeenCalled()
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

describe('POST /api/2fa/verify — backup-code CAS (concurrent consumption)', () => {
  const FRESH = () => new Date()
  const STALE = () => new Date(Date.now() - 10 * 60 * 1000)

  function setupWhitelistUser(overrides: Record<string, unknown> = {}) {
    mockedAuth.mockResolvedValue(makeSession())
    mockedPrisma.whitelistUser.findUnique.mockResolvedValueOnce({
      id: 'u1',
      twoFactorEnabled: true,
      twoFactorSecret: 'enc-secret',
      twoFactorBackupCodes: 'enc-codes',
      lastTwoFactorVerifiedAt: null,
      ...overrides,
    })
    mockedTimingSafeCompare.mockImplementation(
      (a: string, b: string) => a === b,
    )
  }

  async function callVerify(token = 'ABCD1234') {
    const { POST } = await import('@/app/api/2fa/verify/route')
    return POST(makeRequest({ email: 'user@example.com', token }))
  }

  it('retries once on a CAS conflict and the final blob drops BOTH concurrently consumed codes', async () => {
    setupWhitelistUser()
    const { decryptBackupCodes, encryptBackupCodes } = jest.requireMock(
      '@/lib/two-factor',
    ) as { decryptBackupCodes: jest.Mock; encryptBackupCodes: jest.Mock }
    // First read: our code + one other; a concurrent request consumes the
    // other and rewrites the blob to 'enc-codes-2' between our read and our
    // update.
    decryptBackupCodes.mockImplementation((blob: string) =>
      blob === 'enc-codes' ? ['ABCD1234', 'OTHR9999'] : ['ABCD1234'],
    )
    encryptBackupCodes.mockImplementation(
      (codes: string[]) => `enc(${codes.join('|')})`,
    )
    mockedPrisma.whitelistUser.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
    mockedPrisma.whitelistUser.findUnique.mockResolvedValueOnce({
      twoFactorBackupCodes: 'enc-codes-2',
      lastTwoFactorVerifiedAt: null,
    })

    const res = await callVerify()

    expect(res.status).toBe(200)
    expect(mockedPrisma.whitelistUser.updateMany).toHaveBeenCalledTimes(2)
    // Each attempt's WHERE pins the exact blob that attempt decoded.
    expect(mockedPrisma.whitelistUser.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'u1', twoFactorBackupCodes: 'enc-codes' },
      data: {
        twoFactorBackupCodes: 'enc(OTHR9999)',
        lastTwoFactorVerifiedAt: expect.any(Date),
      },
    })
    // The retry re-decoded the FRESH blob, so the final array is missing
    // both the concurrently consumed code and ours.
    expect(mockedPrisma.whitelistUser.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'u1', twoFactorBackupCodes: 'enc-codes-2' },
      data: {
        twoFactorBackupCodes: 'enc()',
        lastTwoFactorVerifiedAt: expect.any(Date),
      },
    })
    expect(mockedClearAttemptsAsync).toHaveBeenCalledWith('2fa-verify:u1')
    expect(mockedRecordFailedAttemptAsync).not.toHaveBeenCalled()
    decryptBackupCodes.mockImplementation(() => ['CODE1', 'CODE2'])
    encryptBackupCodes.mockImplementation(() => 'enc-codes')
  })

  it('stops after exactly two CAS attempts and returns 503 with no rate-limit side effects', async () => {
    setupWhitelistUser()
    const { decryptBackupCodes } = jest.requireMock('@/lib/two-factor') as {
      decryptBackupCodes: jest.Mock
    }
    decryptBackupCodes.mockImplementation((blob: string) =>
      blob === 'enc-codes' ? ['ABCD1234', 'X1'] : ['ABCD1234', 'X2'],
    )
    mockedPrisma.whitelistUser.updateMany.mockResolvedValue({ count: 0 })
    mockedPrisma.whitelistUser.findUnique.mockResolvedValueOnce({
      twoFactorBackupCodes: 'enc-codes-2',
      lastTwoFactorVerifiedAt: null,
    })

    const res = await callVerify()

    expect(res.status).toBe(503)
    expect(mockedPrisma.whitelistUser.updateMany).toHaveBeenCalledTimes(2)
    // Nothing was proven invalid and nothing succeeded: neither record nor
    // clear may touch the rate limit.
    expect(mockedRecordFailedAttemptAsync).not.toHaveBeenCalled()
    expect(mockedClearAttemptsAsync).not.toHaveBeenCalled()
    decryptBackupCodes.mockImplementation(() => ['CODE1', 'CODE2'])
  })

  it('answers RETRY_SYNC when the code vanished after a conflict and the verification is fresh', async () => {
    setupWhitelistUser()
    const { decryptBackupCodes } = jest.requireMock('@/lib/two-factor') as {
      decryptBackupCodes: jest.Mock
    }
    // Present on our first read, gone from the fresh row: a concurrent
    // request (ours, response lost) consumed it and stamped the timestamp.
    decryptBackupCodes.mockImplementation((blob: string) =>
      blob === 'enc-codes' ? ['ABCD1234'] : [],
    )
    mockedPrisma.whitelistUser.updateMany.mockResolvedValueOnce({ count: 0 })
    mockedPrisma.whitelistUser.findUnique.mockResolvedValueOnce({
      twoFactorBackupCodes: 'enc-codes-2',
      lastTwoFactorVerifiedAt: FRESH(),
    })

    const res = await callVerify()

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'Verification already recorded',
      code: 'RETRY_SYNC',
    })
    expect(mockedPrisma.whitelistUser.updateMany).toHaveBeenCalledTimes(1)
    expect(mockedRecordFailedAttemptAsync).not.toHaveBeenCalled()
    expect(mockedClearAttemptsAsync).not.toHaveBeenCalled()
    decryptBackupCodes.mockImplementation(() => ['CODE1', 'CODE2'])
  })

  it('answers RETRY_SYNC when the code is absent from the first read but the verification is fresh', async () => {
    // e.g. a reload dropped the client's recovery state and the user
    // re-submits the code their earlier (lost-response) attempt consumed.
    setupWhitelistUser({ lastTwoFactorVerifiedAt: FRESH() })

    const res = await callVerify('WXYZ9876')

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'Verification already recorded',
      code: 'RETRY_SYNC',
    })
    expect(mockedPrisma.whitelistUser.updateMany).not.toHaveBeenCalled()
    expect(mockedRecordFailedAttemptAsync).not.toHaveBeenCalled()
    expect(mockedClearAttemptsAsync).not.toHaveBeenCalled()
  })

  it('returns a plain 401 (+ failed attempt) only when the code is absent AND no recent verification exists', async () => {
    setupWhitelistUser({ lastTwoFactorVerifiedAt: STALE() })

    const res = await callVerify('WXYZ9876')

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid token' })
    expect(mockedPrisma.whitelistUser.updateMany).not.toHaveBeenCalled()
    expect(mockedRecordFailedAttemptAsync).toHaveBeenCalledWith('2fa-verify:u1')
    expect(mockedClearAttemptsAsync).not.toHaveBeenCalled()
  })

  it('runs the same CAS retry for Admin (both tables verified)', async () => {
    mockedAuth.mockResolvedValue(
      makeSession({ id: 'a1', email: 'admin@example.com', isAdmin: true }),
    )
    mockedPrisma.admin.findUnique.mockResolvedValueOnce({
      id: 'a1',
      twoFactorEnabled: true,
      twoFactorSecret: 'enc-secret',
      twoFactorBackupCodes: 'enc-codes',
      lastTwoFactorVerifiedAt: null,
    })
    mockedTimingSafeCompare.mockImplementation(
      (a: string, b: string) => a === b,
    )
    const { decryptBackupCodes } = jest.requireMock('@/lib/two-factor') as {
      decryptBackupCodes: jest.Mock
    }
    decryptBackupCodes.mockImplementation((blob: string) =>
      blob === 'enc-codes' ? ['ABCD1234', 'Y1'] : ['ABCD1234'],
    )
    mockedPrisma.admin.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
    mockedPrisma.admin.findUnique.mockResolvedValueOnce({
      twoFactorBackupCodes: 'enc-codes-2',
      lastTwoFactorVerifiedAt: null,
    })

    const { POST } = await import('@/app/api/2fa/verify/route')
    const res = await POST(
      makeRequest({
        email: 'admin@example.com',
        token: 'ABCD1234',
        subjectId: 'a1',
        subjectIsAdmin: true,
      }),
    )

    expect(res.status).toBe(200)
    expect(mockedPrisma.admin.updateMany).toHaveBeenCalledTimes(2)
    expect(mockedPrisma.admin.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'a1', twoFactorBackupCodes: 'enc-codes-2' },
      }),
    )
    expect(mockedPrisma.whitelistUser.updateMany).not.toHaveBeenCalled()
    expect(mockedClearAttemptsAsync).toHaveBeenCalledWith('2fa-verify:a1')
    decryptBackupCodes.mockImplementation(() => ['CODE1', 'CODE2'])
  })
})
