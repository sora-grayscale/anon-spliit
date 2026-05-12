/**
 * @jest-environment node
 */

/**
 * Tests for REST API authentication helpers (Issues #142, #166)
 */

import type { Session } from 'next-auth'
import {
  passwordChangeRequiredResponse,
  requiresTwoFactorResponse,
} from './auth-helpers'

function makeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    expires: '2099-01-01T00:00:00.000Z',
    user: {
      id: 'u1',
      email: 'user@example.com',
      isAdmin: false,
      mustChangePassword: false,
      twoFactorEnabled: false,
      requiresTwoFactor: false,
      ...overrides,
    },
  }
}

describe('passwordChangeRequiredResponse', () => {
  it('returns null when session is null', () => {
    expect(passwordChangeRequiredResponse(null)).toBeNull()
  })

  it('returns null when mustChangePassword is false', () => {
    expect(
      passwordChangeRequiredResponse(
        makeSession({ mustChangePassword: false }),
      ),
    ).toBeNull()
  })

  it('returns 403 NextResponse when mustChangePassword is true', async () => {
    const result = passwordChangeRequiredResponse(
      makeSession({ mustChangePassword: true }),
    )
    expect(result).not.toBeNull()
    expect(result?.status).toBe(403)
    const body = await result!.json()
    expect(body).toEqual({ error: 'Password change required' })
  })

  it('returns 403 for admin users too', async () => {
    const result = passwordChangeRequiredResponse(
      makeSession({ isAdmin: true, mustChangePassword: true }),
    )
    expect(result?.status).toBe(403)
  })
})

describe('requiresTwoFactorResponse', () => {
  it('returns null when session is null', () => {
    expect(requiresTwoFactorResponse(null)).toBeNull()
  })

  it('returns null when requiresTwoFactor is false', () => {
    expect(
      requiresTwoFactorResponse(makeSession({ requiresTwoFactor: false })),
    ).toBeNull()
  })

  it('returns 401 NextResponse when requiresTwoFactor is true', async () => {
    const result = requiresTwoFactorResponse(
      makeSession({ requiresTwoFactor: true }),
    )
    expect(result).not.toBeNull()
    expect(result?.status).toBe(401)
    const body = await result!.json()
    expect(body).toEqual({ error: 'Two-factor authentication required' })
  })

  it('is independent of mustChangePassword', async () => {
    // requiresTwoFactor must gate independently of mustChangePassword so the
    // 2FA check fires even when no password change is pending (mirrors the
    // tRPC ordering in src/trpc/init.ts:63-75).
    const result = requiresTwoFactorResponse(
      makeSession({ requiresTwoFactor: true, mustChangePassword: false }),
    )
    expect(result?.status).toBe(401)
  })
})
