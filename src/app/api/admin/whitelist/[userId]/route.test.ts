/**
 * @jest-environment node
 */

/**
 * Route-level tests for the individual whitelist user API (auth-gate
 * hardening).
 *
 * Covers:
 *   - PATCH password reset stamps `passwordChangedAt` (invalidates prior
 *     JWTs via the iat check, Issue #135) alongside password +
 *     mustChangePassword.
 *   - Per-admin operation rate limit on PATCH and DELETE: gate failures and
 *     the 429 do NOT consume a slot; 404 and success each consume exactly
 *     once; the key is prefixed per operation and keyed by the admin id.
 */

jest.mock('@/lib/auth', () => ({
  auth: jest.fn(),
  isPrivateInstance: jest.fn(() => true),
  generateInitialPassword: jest.fn(() => 'INITIAL-PW'),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    whitelistUser: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

jest.mock('@/lib/rate-limit', () => ({
  checkOperationRateLimit: jest.fn(() => ({ isLimited: false })),
  recordOperationAttempt: jest.fn(),
}))

jest.mock('bcryptjs', () => ({
  hash: jest.fn(() => Promise.resolve('hashed')),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  checkOperationRateLimit,
  recordOperationAttempt,
} from '@/lib/rate-limit'
import { DELETE, PATCH } from './route'

const mockedAuth = auth as jest.MockedFunction<typeof auth>
const mockedCheck = checkOperationRateLimit as jest.MockedFunction<
  typeof checkOperationRateLimit
>
const mockedRecord = recordOperationAttempt as jest.MockedFunction<
  typeof recordOperationAttempt
>
const mockedPrisma = prisma as unknown as {
  whitelistUser: {
    findUnique: jest.Mock
    update: jest.Mock
    delete: jest.Mock
  }
}

function makeSession({
  isAdmin = true,
  id = 'a1',
  requiresTwoFactor = false,
  mustChangePassword = false,
} = {}) {
  return {
    user: {
      id,
      email: 'admin@example.com',
      isAdmin,
      mustChangePassword,
      twoFactorEnabled: true,
      requiresTwoFactor,
    },
    expires: '2099-01-01T00:00:00.000Z',
  } as never
}

function patchRequest() {
  return new Request('http://localhost/api/admin/whitelist/w1', {
    method: 'PATCH',
  })
}

function deleteRequest() {
  return new Request('http://localhost/api/admin/whitelist/w1', {
    method: 'DELETE',
  })
}

const params = { params: Promise.resolve({ userId: 'w1' }) }

beforeEach(() => {
  jest.clearAllMocks()
  mockedCheck.mockReturnValue({ isLimited: false })
})

afterEach(() => {
  jest.useRealTimers()
})

describe('PATCH /api/admin/whitelist/[userId] — password reset', () => {
  it('stamps passwordChangedAt alongside password + mustChangePassword', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-14T12:00:00.000Z'))
    mockedAuth.mockResolvedValue(makeSession())
    mockedPrisma.whitelistUser.findUnique.mockResolvedValue({ id: 'w1' })
    mockedPrisma.whitelistUser.update.mockResolvedValue({ id: 'w1' })

    const res = await PATCH(patchRequest(), params)

    expect(res.status).toBe(200)
    const data = mockedPrisma.whitelistUser.update.mock.calls[0][0].data
    expect(data.password).toBe('hashed')
    expect(data.mustChangePassword).toBe(true)
    expect(data.passwordChangedAt).toBeInstanceOf(Date)
    expect(data.passwordChangedAt.toISOString()).toBe(
      '2026-07-14T12:00:00.000Z',
    )
    // Success consumes exactly one slot, keyed by admin id with the reset
    // prefix.
    expect(mockedRecord).toHaveBeenCalledTimes(1)
    expect(mockedCheck).toHaveBeenCalledWith(
      'admin-whitelist-reset:a1',
      60,
      60 * 60 * 1000,
    )
  })

  it('returns 429 with Retry-After and does not consume when rate limited', async () => {
    mockedAuth.mockResolvedValue(makeSession())
    mockedCheck.mockReturnValue({ isLimited: true, retryAfter: 3600 })

    const res = await PATCH(patchRequest(), params)

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('3600')
    expect(mockedRecord).not.toHaveBeenCalled()
    expect(mockedPrisma.whitelistUser.findUnique).not.toHaveBeenCalled()
  })

  it('consumes a slot on 404 (user not found)', async () => {
    mockedAuth.mockResolvedValue(makeSession())
    mockedPrisma.whitelistUser.findUnique.mockResolvedValue(null)

    const res = await PATCH(patchRequest(), params)

    expect(res.status).toBe(404)
    expect(mockedRecord).toHaveBeenCalledTimes(1)
    expect(mockedPrisma.whitelistUser.update).not.toHaveBeenCalled()
  })

  it('does not consume when the admin/id gate fails', async () => {
    // Session with an admin flag but no `id` — the gate must 401 before the
    // limiter so a `...undefined` shared bucket is never keyed.
    mockedAuth.mockResolvedValue({
      user: {
        email: 'admin@example.com',
        isAdmin: true,
        mustChangePassword: false,
        twoFactorEnabled: true,
        requiresTwoFactor: false,
      },
      expires: '2099-01-01T00:00:00.000Z',
    } as never)

    const res = await PATCH(patchRequest(), params)

    expect(res.status).toBe(401)
    expect(mockedCheck).not.toHaveBeenCalled()
    expect(mockedRecord).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/admin/whitelist/[userId]', () => {
  it('consumes one slot on success, keyed with the delete prefix', async () => {
    mockedAuth.mockResolvedValue(makeSession())
    mockedPrisma.whitelistUser.findUnique.mockResolvedValue({ id: 'w1' })
    mockedPrisma.whitelistUser.delete.mockResolvedValue({ id: 'w1' })

    const res = await DELETE(deleteRequest(), params)

    expect(res.status).toBe(200)
    expect(mockedRecord).toHaveBeenCalledTimes(1)
    expect(mockedCheck).toHaveBeenCalledWith(
      'admin-whitelist-delete:a1',
      60,
      60 * 60 * 1000,
    )
  })

  it('returns 429 with Retry-After and does not consume when rate limited', async () => {
    mockedAuth.mockResolvedValue(makeSession())
    mockedCheck.mockReturnValue({ isLimited: true, retryAfter: 3600 })

    const res = await DELETE(deleteRequest(), params)

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('3600')
    expect(mockedRecord).not.toHaveBeenCalled()
    expect(mockedPrisma.whitelistUser.findUnique).not.toHaveBeenCalled()
  })
})
