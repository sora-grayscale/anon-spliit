/**
 * @jest-environment node
 *
 * Route tests for /api/admin/whitelist/[userId] PATCH (Issue #177).
 *
 * Strategy: mock @/lib/auth (`auth`, `isPrivateInstance`,
 * `generateInitialPassword`), @/lib/prisma, and bcryptjs; use the real
 * @/lib/auth-helpers module so session-shape regressions in the 2FA /
 * password-change gates are picked up. The entropy of the shared
 * `generateInitialPassword` helper itself is covered by
 * src/__tests__/private-instance.test.ts — these tests only verify the
 * PATCH route's invocation contract.
 */

jest.mock('@/lib/auth', () => ({
  __esModule: true,
  auth: jest.fn(),
  isPrivateInstance: jest.fn(),
  generateInitialPassword: jest.fn(() => 'A'.repeat(20)),
}))

jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  prisma: {
    whitelistUser: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}))

jest.mock('bcryptjs', () => ({
  __esModule: true,
  default: {
    hash: jest.fn(),
  },
}))

import { PATCH } from '@/app/api/admin/whitelist/[userId]/route'
import { auth, generateInitialPassword, isPrivateInstance } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

// MockedFunction<typeof X> chokes on NextAuth's overloaded `auth` and on
// PrismaPromise return types, so each mock is cast to the wide jest.Mock
// signature (mirrors src/__tests__/admin-whitelist-validation.test.ts).
const mockAuth = auth as unknown as jest.Mock
const mockIsPrivateInstance = isPrivateInstance as unknown as jest.Mock
const mockGenerateInitialPassword =
  generateInitialPassword as unknown as jest.Mock
const mockBcryptHash = bcrypt.hash as unknown as jest.Mock
const mockWhitelistFindUnique = prisma.whitelistUser
  .findUnique as unknown as jest.Mock
const mockWhitelistUpdate = prisma.whitelistUser.update as unknown as jest.Mock

type SessionUser = {
  id: string
  email: string
  name: string
  isAdmin: boolean
  mustChangePassword: boolean
  twoFactorEnabled: boolean
  requiresTwoFactor: boolean
}

const DEFAULT_USER: SessionUser = {
  id: 'admin-id-1',
  email: 'admin@example.com',
  name: 'Admin',
  isAdmin: true,
  mustChangePassword: false,
  twoFactorEnabled: false,
  requiresTwoFactor: false,
}

function makeSession(
  overrides: Partial<SessionUser> = {},
): Awaited<ReturnType<typeof auth>> {
  return {
    user: { ...DEFAULT_USER, ...overrides },
    expires: new Date(Date.now() + 60 * 1000).toISOString(),
  } as unknown as Awaited<ReturnType<typeof auth>>
}

const TARGET_USER_ID = 'cwhitelist-user-test-id'

function makeRequest(): Request {
  return new Request(`http://localhost/api/admin/whitelist/${TARGET_USER_ID}`, {
    method: 'PATCH',
  })
}

function makeContext() {
  return { params: Promise.resolve({ userId: TARGET_USER_ID }) }
}

function setupValidSession(overrides: Partial<SessionUser> = {}) {
  mockIsPrivateInstance.mockReturnValue(true)
  mockAuth.mockResolvedValue(makeSession(overrides))
  // `jest.resetAllMocks()` in beforeEach wipes the mock's initial impl,
  // so re-establish the fixed return value per test for stability.
  mockGenerateInitialPassword.mockReturnValue('A'.repeat(20))
}

beforeEach(() => {
  jest.resetAllMocks()
})

describe('PATCH /api/admin/whitelist/[userId] — gates do not touch helper or DB', () => {
  it('returns 400 when private instance is disabled', async () => {
    mockIsPrivateInstance.mockReturnValue(false)
    const res = await PATCH(makeRequest(), makeContext())
    expect(res.status).toBe(400)
    expect(mockGenerateInitialPassword).not.toHaveBeenCalled()
    expect(mockBcryptHash).not.toHaveBeenCalled()
    expect(mockWhitelistFindUnique).not.toHaveBeenCalled()
    expect(mockWhitelistUpdate).not.toHaveBeenCalled()
  })

  it('returns 401 when session is missing', async () => {
    mockIsPrivateInstance.mockReturnValue(true)
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makeRequest(), makeContext())
    expect(res.status).toBe(401)
    expect(mockGenerateInitialPassword).not.toHaveBeenCalled()
    expect(mockWhitelistUpdate).not.toHaveBeenCalled()
  })

  it('returns 401 when user is not admin', async () => {
    mockIsPrivateInstance.mockReturnValue(true)
    mockAuth.mockResolvedValue(makeSession({ isAdmin: false }))
    const res = await PATCH(makeRequest(), makeContext())
    expect(res.status).toBe(401)
    expect(mockGenerateInitialPassword).not.toHaveBeenCalled()
    expect(mockWhitelistUpdate).not.toHaveBeenCalled()
  })

  it('returns 401 with the real auth-helpers body when 2FA is required', async () => {
    mockIsPrivateInstance.mockReturnValue(true)
    mockAuth.mockResolvedValue(makeSession({ requiresTwoFactor: true }))
    const res = await PATCH(makeRequest(), makeContext())
    expect(res.status).toBe(401)
    // Real `requiresTwoFactorResponse` body shape pin — auth-helpers is
    // not mocked, so this catches any drift in the gate's contract.
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Two-factor authentication required')
    expect(mockGenerateInitialPassword).not.toHaveBeenCalled()
    expect(mockWhitelistUpdate).not.toHaveBeenCalled()
  })

  it('returns 403 with the real auth-helpers body when password change is required', async () => {
    mockIsPrivateInstance.mockReturnValue(true)
    mockAuth.mockResolvedValue(makeSession({ mustChangePassword: true }))
    const res = await PATCH(makeRequest(), makeContext())
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Password change required')
    expect(mockGenerateInitialPassword).not.toHaveBeenCalled()
    expect(mockWhitelistUpdate).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/admin/whitelist/[userId] — user lookup', () => {
  it('returns 404 when the whitelist user does not exist', async () => {
    setupValidSession()
    mockWhitelistFindUnique.mockResolvedValue(null)
    const res = await PATCH(makeRequest(), makeContext())
    expect(res.status).toBe(404)
    expect(mockGenerateInitialPassword).not.toHaveBeenCalled()
    expect(mockWhitelistUpdate).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/admin/whitelist/[userId] — success contract', () => {
  it('uses the shared helper, hashes its output, and persists mustChangePassword=true', async () => {
    setupValidSession()
    const HASHED_PWD = 'bcrypt-hash-output-fixed'
    mockWhitelistFindUnique.mockResolvedValue({
      id: TARGET_USER_ID,
      email: 'u@example.com',
    } as never)
    mockBcryptHash.mockResolvedValue(HASHED_PWD as never)
    mockWhitelistUpdate.mockResolvedValue({ id: TARGET_USER_ID } as never)

    const res = await PATCH(makeRequest(), makeContext())
    expect(res.status).toBe(200)

    const json = (await res.json()) as { initialPassword: string }
    // 1. The shared helper output flows back to the client unchanged.
    expect(json.initialPassword).toBe('A'.repeat(20))
    // 2. The same helper output is what bcrypt.hash sees (cost 12).
    expect(mockBcryptHash).toHaveBeenCalledWith('A'.repeat(20), 12)
    // 3 + 4. `where` keys on the route's `userId` param; `data` sets
    // `password` to the bcrypt output AND `mustChangePassword: true`.
    // The latter ensures the user is forced through the change-password
    // flow on next login — a regression here would let a reset user log
    // in indefinitely without changing the admin-issued password.
    expect(mockWhitelistUpdate).toHaveBeenCalledWith({
      where: { id: TARGET_USER_ID },
      data: {
        password: HASHED_PWD,
        mustChangePassword: true,
      },
    })
    expect(mockGenerateInitialPassword).toHaveBeenCalledTimes(1)
  })
})
