/**
 * @jest-environment node
 */

/**
 * Regression tests for the JWT callback's per-request refresh of
 * security-critical user fields (Issue #173).
 *
 * The callback is exported from `@/lib/auth-jwt` so it can be exercised
 * directly without booting the NextAuth runtime in `@/lib/auth`. Here we
 * mock `@/lib/session-validation` so each test pins the
 * `refreshJwtFromUser` return value and asserts the callback's reaction:
 *
 *  - Admin role revoke -> token identity stripped on next request.
 *  - Admin disables a user's 2FA -> `requiresTwoFactor` clears so the user
 *    is not stuck on the 2FA gate.
 *  - Admin sets `mustChangePassword=true` -> reflected on next request.
 *  - 2FA newly enabled while session is alive -> `requiresTwoFactor`
 *    becomes true so the user must re-verify.
 *  - Issue #135 (password rotation) and #123 (5-minute verification
 *    window) keep working through the new code path.
 */

import type { JWT } from 'next-auth/jwt'

jest.mock('@/lib/session-validation', () => ({
  refreshJwtFromUser: jest.fn(),
}))

import { jwtCallback } from '@/lib/auth-jwt'
import { refreshJwtFromUser } from '@/lib/session-validation'

const mockedRefresh = refreshJwtFromUser as jest.MockedFunction<
  typeof refreshJwtFromUser
>

// Helper: build a token with the security-critical claims our codebase
// stores. `as unknown as JWT` lets us bypass the strict JWT type while
// keeping the shape explicit at each test site.
function makeToken(overrides: Record<string, unknown>): JWT {
  return {
    sub: 'user-1',
    iat: 1_700_000_000,
    isAdmin: false,
    mustChangePassword: false,
    twoFactorEnabled: false,
    requiresTwoFactor: false,
    ...overrides,
  } as unknown as JWT
}

describe('jwtCallback (Issue #173)', () => {
  beforeEach(() => {
    mockedRefresh.mockReset()
  })

  describe('initial sign-in (user parameter present)', () => {
    it('seeds the token from authorize() and still refreshes from DB', async () => {
      mockedRefresh.mockResolvedValueOnce({
        isAdmin: true,
        mustChangePassword: false,
        twoFactorEnabled: true,
        lastTwoFactorVerifiedAt: null,
      })

      const token = makeToken({ isAdmin: false })
      const result = await jwtCallback({
        token,
        user: {
          id: 'user-1',
          email: 'admin@example.com',
          isAdmin: true,
          mustChangePassword: false,
          twoFactorEnabled: true,
          requiresTwoFactor: true,
        },
        trigger: 'signIn',
      })

      // user.isAdmin=true seeded, then DB refresh keeps it true.
      expect((result as Record<string, unknown>).isAdmin).toBe(true)
      expect((result as Record<string, unknown>).twoFactorEnabled).toBe(true)
      // requiresTwoFactor stays true because the DB confirms 2FA is on and
      // it was just seeded as true (no transition to clear it).
      expect((result as Record<string, unknown>).requiresTwoFactor).toBe(true)
    })
  })

  describe('admin-driven changes (Issue #173)', () => {
    it('admin role revoke -> token identity stripped', async () => {
      // refreshJwtFromUser returns null when the user is no longer in the
      // expected table (e.g. admin row removed).
      mockedRefresh.mockResolvedValueOnce(null)

      const token = makeToken({
        isAdmin: true,
        twoFactorEnabled: true,
        requiresTwoFactor: false,
      })

      const result = (await jwtCallback({ token })) as Record<string, unknown>

      expect(result.sub).toBeUndefined()
      expect(result.isAdmin).toBe(false)
      expect(result.mustChangePassword).toBe(false)
      expect(result.twoFactorEnabled).toBe(false)
      expect(result.requiresTwoFactor).toBe(false)
    })

    it('admin disables user 2FA -> requiresTwoFactor clears', async () => {
      // Pre: user's session had 2FA verified.
      // Admin disables 2FA on this account.
      mockedRefresh.mockResolvedValueOnce({
        isAdmin: false,
        mustChangePassword: false,
        twoFactorEnabled: false,
        lastTwoFactorVerifiedAt: null,
      })

      const token = makeToken({
        twoFactorEnabled: true,
        requiresTwoFactor: true,
      })

      const result = (await jwtCallback({ token })) as Record<string, unknown>

      expect(result.twoFactorEnabled).toBe(false)
      // Cleared so the user is not stuck on a 2FA gate they can no longer pass.
      expect(result.requiresTwoFactor).toBe(false)
    })

    it('admin sets mustChangePassword=true -> token reflects it', async () => {
      mockedRefresh.mockResolvedValueOnce({
        isAdmin: false,
        mustChangePassword: true,
        twoFactorEnabled: false,
        lastTwoFactorVerifiedAt: null,
      })

      const token = makeToken({ mustChangePassword: false })

      const result = (await jwtCallback({ token })) as Record<string, unknown>

      expect(result.mustChangePassword).toBe(true)
    })

    it('2FA newly enabled while session is active -> requiresTwoFactor set true', async () => {
      mockedRefresh.mockResolvedValueOnce({
        isAdmin: false,
        mustChangePassword: false,
        twoFactorEnabled: true,
        lastTwoFactorVerifiedAt: null,
      })

      const token = makeToken({
        twoFactorEnabled: false,
        requiresTwoFactor: false,
      })

      const result = (await jwtCallback({ token })) as Record<string, unknown>

      expect(result.twoFactorEnabled).toBe(true)
      // Defense in depth: a transition from off to on forces re-verification
      // even though no `trigger === 'update'` was involved.
      expect(result.requiresTwoFactor).toBe(true)
    })

    it('preserves requiresTwoFactor=false when 2FA stays enabled (mid-session refetch)', async () => {
      // The user verified 2FA earlier in this session and is now making
      // another request. Refresh sees 2FA still on; we must not re-arm
      // requiresTwoFactor or every request after verification would
      // bounce the user back to the 2FA gate.
      mockedRefresh.mockResolvedValueOnce({
        isAdmin: false,
        mustChangePassword: false,
        twoFactorEnabled: true,
        lastTwoFactorVerifiedAt: new Date(),
      })

      const token = makeToken({
        twoFactorEnabled: true,
        requiresTwoFactor: false,
      })

      const result = (await jwtCallback({ token })) as Record<string, unknown>

      expect(result.requiresTwoFactor).toBe(false)
    })
  })

  describe('Issue #135 (password rotation) still rejects stale tokens', () => {
    it('returns a stripped-identity token when refresh returns null', async () => {
      // session-validation returns null when the token's iat predates the
      // user's passwordChangedAt. The callback must clear identity.
      mockedRefresh.mockResolvedValueOnce(null)

      const token = makeToken({
        isAdmin: true,
        mustChangePassword: false,
        twoFactorEnabled: true,
        requiresTwoFactor: false,
      })

      const result = (await jwtCallback({ token })) as Record<string, unknown>

      expect(result.sub).toBeUndefined()
      expect(result.isAdmin).toBe(false)
    })
  })

  describe('Issue #123 (5-minute 2FA verification window)', () => {
    const now = 1_700_000_000_000 // ms

    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(now)
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('clears requiresTwoFactor when trigger=update and server saw a recent verification', async () => {
      mockedRefresh.mockResolvedValueOnce({
        isAdmin: false,
        mustChangePassword: false,
        twoFactorEnabled: true,
        // Verified 1 minute ago -> within the 5 minute window.
        lastTwoFactorVerifiedAt: new Date(now - 60_000),
      })

      const token = makeToken({
        twoFactorEnabled: true,
        requiresTwoFactor: true,
      })

      const result = (await jwtCallback({
        token,
        trigger: 'update',
        session: { twoFactorVerified: true },
      })) as Record<string, unknown>

      expect(result.requiresTwoFactor).toBe(false)
    })

    it('keeps requiresTwoFactor=true when server has no fresh verification', async () => {
      mockedRefresh.mockResolvedValueOnce({
        isAdmin: false,
        mustChangePassword: false,
        twoFactorEnabled: true,
        // Verified 10 minutes ago -> outside the 5 minute window.
        lastTwoFactorVerifiedAt: new Date(now - 10 * 60_000),
      })

      const token = makeToken({
        twoFactorEnabled: true,
        requiresTwoFactor: true,
      })

      const result = (await jwtCallback({
        token,
        trigger: 'update',
        session: { twoFactorVerified: true },
      })) as Record<string, unknown>

      // Client-forged twoFactorVerified must not bypass an absent / stale
      // server-side record.
      expect(result.requiresTwoFactor).toBe(true)
    })

    it('ignores client twoFactorVerified outside trigger=update', async () => {
      mockedRefresh.mockResolvedValueOnce({
        isAdmin: false,
        mustChangePassword: false,
        twoFactorEnabled: true,
        lastTwoFactorVerifiedAt: new Date(now),
      })

      const token = makeToken({
        twoFactorEnabled: true,
        requiresTwoFactor: true,
      })

      const result = (await jwtCallback({
        token,
        // No trigger='update' -> the verification-window branch is not entered.
        session: { twoFactorVerified: true },
      })) as Record<string, unknown>

      expect(result.requiresTwoFactor).toBe(true)
    })
  })

  describe('refresh-call wiring', () => {
    it('passes the token sub, isAdmin claim, and iat to refreshJwtFromUser', async () => {
      mockedRefresh.mockResolvedValueOnce({
        isAdmin: true,
        mustChangePassword: false,
        twoFactorEnabled: false,
        lastTwoFactorVerifiedAt: null,
      })

      const token = makeToken({
        sub: 'admin-42',
        iat: 1_700_000_500,
        isAdmin: true,
      })

      await jwtCallback({ token })

      expect(mockedRefresh).toHaveBeenCalledWith(
        'admin-42',
        true,
        1_700_000_500,
      )
    })

    it('skips refresh entirely when token.sub is missing', async () => {
      const token = makeToken({ sub: undefined })

      const result = await jwtCallback({ token })

      expect(mockedRefresh).not.toHaveBeenCalled()
      expect(result).toBe(token)
    })
  })
})
