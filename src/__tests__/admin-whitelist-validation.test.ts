/**
 * @jest-environment node
 *
 * Route tests for /api/admin/whitelist POST (Issue #176).
 *
 * Strategy: mock @/lib/auth, @/lib/rate-limit, @/lib/prisma, and bcryptjs;
 * use the real @/lib/auth-helpers module so session-shape regressions in
 * the 2FA / password-change gates are picked up. The 60/61 limiter
 * boundary itself is covered by src/lib/rate-limit.test.ts — these tests
 * only verify the route's invocation contract.
 */

jest.mock('@/lib/auth', () => ({
  __esModule: true,
  auth: jest.fn(),
  isPrivateInstance: jest.fn(),
  generateInitialPassword: jest.fn(() => 'A'.repeat(20)),
}))

jest.mock('@/lib/rate-limit', () => ({
  __esModule: true,
  checkOperationRateLimit: jest.fn(),
  recordOperationAttempt: jest.fn(),
}))

jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  prisma: {
    whitelistUser: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    admin: {
      findUnique: jest.fn(),
    },
  },
}))

jest.mock('bcryptjs', () => ({
  __esModule: true,
  default: {
    hash: jest.fn(),
  },
}))

import { POST } from '@/app/api/admin/whitelist/route'
import { auth, generateInitialPassword, isPrivateInstance } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  checkOperationRateLimit,
  recordOperationAttempt,
} from '@/lib/rate-limit'
import bcrypt from 'bcryptjs'

// MockedFunction<typeof X> chokes on NextAuth's overloaded `auth` and on
// PrismaPromise return types, so each mock is cast to the wide jest.Mock
// signature. Tests work with mock return values directly, not with the
// real call signatures, so the loss of type safety is acceptable.
const mockAuth = auth as unknown as jest.Mock
const mockIsPrivateInstance = isPrivateInstance as unknown as jest.Mock
const mockGenerateInitialPassword =
  generateInitialPassword as unknown as jest.Mock
const mockCheck = checkOperationRateLimit as unknown as jest.Mock
const mockRecord = recordOperationAttempt as unknown as jest.Mock
const mockBcryptHash = bcrypt.hash as unknown as jest.Mock
const mockWhitelistFindUnique = prisma.whitelistUser
  .findUnique as unknown as jest.Mock
const mockWhitelistCreate = prisma.whitelistUser.create as unknown as jest.Mock
const mockAdminFindUnique = prisma.admin.findUnique as unknown as jest.Mock

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

function streamBody(content: string): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode(content)
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoded)
      controller.close()
    },
  })
}

function makeRequest(body: BodyInit | null): Request {
  // `duplex: 'half'` is required by Node 20's fetch API when sending a
  // streaming Request body. RequestInit's static typing does not include
  // `duplex` in every TS version, so the minimal cast is test-side only.
  return new Request('http://localhost/api/admin/whitelist', {
    method: 'POST',
    body,
    ...({ duplex: 'half' } as Record<string, unknown>),
  })
}

function setupValidSession(overrides: Partial<SessionUser> = {}) {
  mockIsPrivateInstance.mockReturnValue(true)
  mockAuth.mockResolvedValue(makeSession(overrides))
  mockCheck.mockReturnValue({ isLimited: false, remainingAttempts: 60 })
  // `jest.resetAllMocks()` in beforeEach wipes the mock's initial impl,
  // so the literal default needs to be re-established per test.
  mockGenerateInitialPassword.mockReturnValue('A'.repeat(20))
}

beforeEach(() => {
  jest.resetAllMocks()
})

describe('POST /api/admin/whitelist — section A (gates do not touch limiter)', () => {
  it('returns 400 when private instance is disabled', async () => {
    mockIsPrivateInstance.mockReturnValue(false)
    const res = await POST(makeRequest(streamBody('{}')))
    expect(res.status).toBe(400)
    expect(mockCheck).not.toHaveBeenCalled()
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('returns 401 when session is missing', async () => {
    mockIsPrivateInstance.mockReturnValue(true)
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest(streamBody('{}')))
    expect(res.status).toBe(401)
    expect(mockCheck).not.toHaveBeenCalled()
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('returns 401 when user is not admin', async () => {
    mockIsPrivateInstance.mockReturnValue(true)
    mockAuth.mockResolvedValue(makeSession({ isAdmin: false }))
    const res = await POST(makeRequest(streamBody('{}')))
    expect(res.status).toBe(401)
    expect(mockCheck).not.toHaveBeenCalled()
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('returns 401 when 2FA is still required', async () => {
    mockIsPrivateInstance.mockReturnValue(true)
    mockAuth.mockResolvedValue(makeSession({ requiresTwoFactor: true }))
    const res = await POST(makeRequest(streamBody('{}')))
    expect(res.status).toBe(401)
    expect(mockCheck).not.toHaveBeenCalled()
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('returns 403 when password change is required', async () => {
    mockIsPrivateInstance.mockReturnValue(true)
    mockAuth.mockResolvedValue(makeSession({ mustChangePassword: true }))
    const res = await POST(makeRequest(streamBody('{}')))
    expect(res.status).toBe(403)
    expect(mockCheck).not.toHaveBeenCalled()
    expect(mockRecord).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/whitelist — section B (CHECK limited)', () => {
  it('returns 429 + Retry-After when limiter is exhausted; record is not called', async () => {
    mockIsPrivateInstance.mockReturnValue(true)
    mockAuth.mockResolvedValue(makeSession())
    mockCheck.mockReturnValue({ isLimited: true, retryAfter: 1234 })
    const res = await POST(makeRequest(streamBody('{}')))
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('1234')
    expect(mockRecord).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/whitelist — section C (body-size / parse, record once)', () => {
  it('returns 413 when streamed body exceeds 4 KB', async () => {
    setupValidSession()
    const huge = 'x'.repeat(5000)
    const res = await POST(makeRequest(streamBody(huge)))
    expect(res.status).toBe(413)
    expect(mockRecord).toHaveBeenCalledTimes(1)
  })

  it('returns 400 when the request has no body', async () => {
    setupValidSession()
    const res = await POST(makeRequest(null))
    expect(res.status).toBe(400)
    expect(mockRecord).toHaveBeenCalledTimes(1)
  })

  it('returns 400 on malformed JSON', async () => {
    setupValidSession()
    const res = await POST(makeRequest(streamBody('{invalid')))
    expect(res.status).toBe(400)
    expect(mockRecord).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/admin/whitelist — section D (zod, record once)', () => {
  beforeEach(() => {
    setupValidSession()
  })

  it('returns 400 when email is missing', async () => {
    const res = await POST(makeRequest(streamBody('{}')))
    expect(res.status).toBe(400)
    expect(mockRecord).toHaveBeenCalledTimes(1)
  })

  it('returns 400 when email is not a string', async () => {
    const res = await POST(makeRequest(streamBody('{"email":42}')))
    expect(res.status).toBe(400)
    expect(mockRecord).toHaveBeenCalledTimes(1)
  })

  it('returns 400 on invalid email format', async () => {
    const res = await POST(makeRequest(streamBody('{"email":"not-an-email"}')))
    expect(res.status).toBe(400)
    expect(mockRecord).toHaveBeenCalledTimes(1)
  })

  it('returns 400 when email exceeds 254 chars', async () => {
    const localPart = 'a'.repeat(255 - '@example.com'.length)
    const longEmail = `${localPart}@example.com`
    const res = await POST(
      makeRequest(streamBody(JSON.stringify({ email: longEmail }))),
    )
    expect(res.status).toBe(400)
    expect(mockRecord).toHaveBeenCalledTimes(1)
  })

  it('returns 400 when name is not a string', async () => {
    const res = await POST(
      makeRequest(streamBody('{"email":"a@b.co","name":42}')),
    )
    expect(res.status).toBe(400)
    expect(mockRecord).toHaveBeenCalledTimes(1)
  })

  it('returns 400 when name exceeds 100 chars', async () => {
    const body = JSON.stringify({
      email: 'a@b.co',
      name: 'x'.repeat(101),
    })
    const res = await POST(makeRequest(streamBody(body)))
    expect(res.status).toBe(400)
    expect(mockRecord).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/admin/whitelist — section E (name backward compat → null)', () => {
  beforeEach(() => {
    setupValidSession()
    mockWhitelistFindUnique.mockResolvedValue(null)
    mockAdminFindUnique.mockResolvedValue(null)
    mockBcryptHash.mockResolvedValue('hashed' as never)
    mockWhitelistCreate.mockImplementation(
      async ({ data }) =>
        ({
          id: 'u1',
          email: data.email,
          name: data.name ?? null,
          createdAt: new Date('2026-05-20T00:00:00Z'),
        }) as never,
    )
  })

  it('normalizes omitted name to null', async () => {
    const res = await POST(makeRequest(streamBody('{"email":"a@b.co"}')))
    expect(res.status).toBe(200)
    expect(mockWhitelistCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: null }),
      }),
    )
  })

  it('normalizes empty-string name to null', async () => {
    const res = await POST(
      makeRequest(streamBody('{"email":"a@b.co","name":""}')),
    )
    expect(res.status).toBe(200)
    expect(mockWhitelistCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: null }),
      }),
    )
  })

  it('normalizes null name to null', async () => {
    const res = await POST(
      makeRequest(streamBody('{"email":"a@b.co","name":null}')),
    )
    expect(res.status).toBe(200)
    expect(mockWhitelistCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: null }),
      }),
    )
  })
})

describe('POST /api/admin/whitelist — section F (business duplicates, record once)', () => {
  beforeEach(() => {
    setupValidSession()
  })

  it('returns 400 when the email is already a whitelist user', async () => {
    mockWhitelistFindUnique.mockResolvedValue({
      id: 'existing',
      email: 'a@b.co',
    } as never)
    const res = await POST(makeRequest(streamBody('{"email":"a@b.co"}')))
    expect(res.status).toBe(400)
    expect(mockRecord).toHaveBeenCalledTimes(1)
    expect(mockWhitelistCreate).not.toHaveBeenCalled()
  })

  it('returns 400 when the email is already an admin', async () => {
    mockWhitelistFindUnique.mockResolvedValue(null)
    mockAdminFindUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'a@b.co',
    } as never)
    const res = await POST(makeRequest(streamBody('{"email":"a@b.co"}')))
    expect(res.status).toBe(400)
    expect(mockRecord).toHaveBeenCalledTimes(1)
    expect(mockWhitelistCreate).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/whitelist — section G (success + 500, reserved-slot semantics)', () => {
  beforeEach(() => {
    setupValidSession()
  })

  it('returns 200 + initialPassword and persists name on success', async () => {
    mockWhitelistFindUnique.mockResolvedValue(null)
    mockAdminFindUnique.mockResolvedValue(null)
    mockBcryptHash.mockResolvedValue('hashed' as never)
    mockWhitelistCreate.mockResolvedValue({
      id: 'u1',
      email: 'a@b.co',
      name: 'Alice',
      createdAt: new Date('2026-05-20T00:00:00Z'),
    } as never)

    const res = await POST(
      makeRequest(streamBody('{"email":"a@b.co","name":"Alice"}')),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      user: { email: string; name: string | null }
      initialPassword: string
    }
    expect(json.user.email).toBe('a@b.co')
    expect(json.user.name).toBe('Alice')
    // Pin the shared `generateInitialPassword` helper (Issue #177): the
    // mock returns `'A'.repeat(20)` and that exact value must flow into
    // both the response and bcrypt.hash so a future refactor that drops
    // the helper import (or bypasses it) is caught here.
    expect(json.initialPassword).toBe('A'.repeat(20))
    expect(mockBcryptHash).toHaveBeenCalledWith('A'.repeat(20), 12)
    expect(mockRecord).toHaveBeenCalledTimes(1)
  })

  it('records an attempt even when bcrypt.hash throws (outer-catch 500)', async () => {
    mockWhitelistFindUnique.mockResolvedValue(null)
    mockAdminFindUnique.mockResolvedValue(null)
    mockBcryptHash.mockRejectedValue(new Error('boom') as never)

    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    const res = await POST(
      makeRequest(streamBody('{"email":"a@b.co","name":"Alice"}')),
    )
    expect(res.status).toBe(500)
    expect(mockRecord).toHaveBeenCalledTimes(1)

    consoleErrorSpy.mockRestore()
  })
})

describe('POST /api/admin/whitelist — section H (rate-limit key separation)', () => {
  beforeEach(() => {
    setupValidSession()
    mockWhitelistFindUnique.mockResolvedValue(null)
    mockAdminFindUnique.mockResolvedValue(null)
    mockBcryptHash.mockResolvedValue('hashed' as never)
    mockWhitelistCreate.mockImplementation(
      async ({ data }) =>
        ({
          id: 'u1',
          email: data.email,
          name: data.name ?? null,
          createdAt: new Date('2026-05-20T00:00:00Z'),
        }) as never,
    )
  })

  it('keys check/record by session.user.id (not by body email/name) and separates per admin', async () => {
    mockAuth.mockResolvedValue(makeSession({ id: 'admin-A' }))
    await POST(makeRequest(streamBody('{"email":"victim1@e.x","name":"X"}')))
    await POST(makeRequest(streamBody('{"email":"victim2@e.x","name":"Y"}')))

    mockAuth.mockResolvedValue(makeSession({ id: 'admin-B' }))
    await POST(makeRequest(streamBody('{"email":"victim3@e.x","name":"Z"}')))

    const recordKeys = mockRecord.mock.calls.map((call) => call[0])
    expect(recordKeys).toEqual([
      'admin-whitelist:admin-A',
      'admin-whitelist:admin-A',
      'admin-whitelist:admin-B',
    ])
    const checkKeys = mockCheck.mock.calls.map((call) => call[0])
    expect(checkKeys).toEqual([
      'admin-whitelist:admin-A',
      'admin-whitelist:admin-A',
      'admin-whitelist:admin-B',
    ])
    for (const call of mockRecord.mock.calls) {
      expect(call[1]).toBe(60)
      expect(call[2]).toBe(60 * 60 * 1000)
    }
  })

  it('reserves the limiter slot synchronously after CHECK (no awaited mock invocation between them)', async () => {
    const res = await POST(makeRequest(streamBody('{"email":"a@b.co"}')))
    expect(res.status).toBe(200)
    expect(mockCheck).toHaveBeenCalledTimes(1)
    expect(mockRecord).toHaveBeenCalledTimes(1)
    // jest tracks a monotonic, cross-mock invocationCallOrder. If
    // `recordOperationAttempt` is the very next mock invocation after
    // `checkOperationRateLimit`, then no other awaited dependency
    // (prisma, bcrypt, body reader, etc.) ran between them — proving
    // the slot is reserved before any await. Without this, a
    // concurrent burst of admin POSTs could all pass CHECK at low
    // counts before any of them awaited record (Codex review iter 1
    // on PR #231).
    //
    // Note: Node 20 buffers ReadableStream request bodies during
    // `new Request(...)` construction, so a pull()-based ordering
    // probe would fire before the route ever ran. invocationCallOrder
    // sidesteps that quirk by working off jest's own mock counters.
    const checkOrder = mockCheck.mock.invocationCallOrder[0]
    const recordOrder = mockRecord.mock.invocationCallOrder[0]
    expect(recordOrder).toBe(checkOrder + 1)
  })
})
