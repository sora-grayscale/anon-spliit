/**
 * @jest-environment node
 */

/**
 * Tests for REST API authentication helpers (Issue #142)
 */

import type { Session } from 'next-auth'
import { passwordChangeRequiredResponse } from './auth-helpers'

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
