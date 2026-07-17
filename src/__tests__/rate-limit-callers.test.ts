/**
 * @jest-environment node
 */

/**
 * Caller-side regression tests for Issue #167.
 *
 * The sync `checkRateLimit` entry point silently returns `{ isLimited:
 * false }` when `RATE_LIMIT_STORAGE` is not `memory`, which bypassed all
 * rate limiting in distributed deployments. The fix migrates every
 * in-repo caller to the async API. These tests pin that wiring: if a
 * future refactor re-introduces a sync `checkRateLimit(...)` call, the
 * mocked async function won't see `isLimited: true` and the assertion
 * here will fail.
 *
 * Two representative caller paths are exercised:
 *   - POST /api/auth/change-password
 *   - POST /api/2fa/verify
 * Other handlers (verify-setup, 2fa/disable) share the same call shape
 * and are covered by code review.
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

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => ({ isLimited: false })),
  recordFailedAttempt: jest.fn(),
  clearAttempts: jest.fn(),
  checkRateLimitAsync: jest.fn(),
  recordFailedAttemptAsync: jest.fn(() => Promise.resolve()),
  clearAttemptsAsync: jest.fn(() => Promise.resolve()),
}))

jest.mock('@/lib/two-factor', () => ({
  decryptSecret: jest.fn(() => 'SECRET'),
  verifyTOTP: jest.fn(() => false),
  decryptBackupCodes: jest.fn(() => ['CODE1']),
  encryptBackupCodes: jest.fn(() => 'enc-codes'),
  normalizeToken: jest.fn((t: string) => t),
  timingSafeCompare: jest.fn(() => false),
  generateTOTPSecret: jest.fn(() => ({ secret: 'S', otpauthUrl: 'o' })),
  generateQRCode: jest.fn(() => Promise.resolve('data:image/png;base64,xxx')),
  generateBackupCodes: jest.fn(() => ['CODE1']),
  encryptSecret: jest.fn(() => 'enc-secret'),
}))

jest.mock('bcryptjs', () => ({
  compare: jest.fn(() => Promise.resolve(true)),
  hash: jest.fn(() => Promise.resolve('hashed')),
}))

import { auth } from '@/lib/auth'
import { checkRateLimitAsync } from '@/lib/rate-limit'

const mockedAuth = auth as jest.MockedFunction<typeof auth>
const mockedCheckRateLimitAsync = checkRateLimitAsync as jest.MockedFunction<
  typeof checkRateLimitAsync
>

function makeSession({
  requiresTwoFactor = false,
}: { requiresTwoFactor?: boolean } = {}) {
  return {
    user: {
      id: 'u1',
      email: 'user@example.com',
      isAdmin: false,
      mustChangePassword: false,
      twoFactorEnabled: true,
      requiresTwoFactor,
    },
    expires: '2099-01-01T00:00:00.000Z',
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  // Default to not limited so the gate doesn't trigger unless a test opts in.
  mockedCheckRateLimitAsync.mockResolvedValue({ isLimited: false })
})

describe('rate-limit async callers (Issue #167)', () => {
  it('POST /api/auth/change-password returns 429 from the async rate limit', async () => {
    mockedAuth.mockResolvedValue(makeSession())
    mockedCheckRateLimitAsync.mockResolvedValueOnce({
      isLimited: true,
      retryAfter: 60,
    })

    const { POST } = await import('@/app/api/auth/change-password/route')
    const request = new Request('http://localhost/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: 'old',
        newPassword: 'newpass12',
      }),
    })
    const res = await POST(request)

    expect(res.status).toBe(429)
    const body = (await res.json()) as { retryAfter?: number; error: string }
    expect(body.retryAfter).toBe(60)
    expect(body.error).toMatch(/too many/i)
    // The caller must use the async API; if a future refactor re-introduces
    // the sync `checkRateLimit`, this expectation will fail.
    expect(mockedCheckRateLimitAsync).toHaveBeenCalledTimes(1)
  })

  it('POST /api/2fa/verify returns 429 from the async rate limit', async () => {
    // After Issue #174 the verify endpoint gates on auth() + email match +
    // requiresTwoFactor=true BEFORE the rate-limit check. Set up a session
    // that passes those gates so we actually reach the rate-limit branch.
    mockedAuth.mockResolvedValue(makeSession({ requiresTwoFactor: true }))
    mockedCheckRateLimitAsync.mockResolvedValueOnce({
      isLimited: true,
      retryAfter: 30,
    })

    const { POST } = await import('@/app/api/2fa/verify/route')
    const request = new Request('http://localhost/api/2fa/verify', {
      method: 'POST',
      body: JSON.stringify({
        email: 'user@example.com',
        token: '123456',
        subjectId: 'u1',
        subjectIsAdmin: false,
      }),
    })
    const res = await POST(request)

    expect(res.status).toBe(429)
    const body = (await res.json()) as { retryAfter?: number; error: string }
    expect(body.retryAfter).toBe(30)
    expect(body.error).toMatch(/too many/i)
    expect(mockedCheckRateLimitAsync).toHaveBeenCalledTimes(1)
  })
})
