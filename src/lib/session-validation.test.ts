/**
 * @jest-environment node
 */

import {
  isTokenIatAcceptable,
  refreshJwtFromUser,
} from './session-validation'

jest.mock('./prisma', () => ({
  prisma: {
    admin: {
      findUnique: jest.fn(),
    },
    whitelistUser: {
      findUnique: jest.fn(),
    },
  },
}))

import { prisma } from './prisma'

const mockedAdminFind = prisma.admin.findUnique as jest.Mock
const mockedWhitelistFind = prisma.whitelistUser.findUnique as jest.Mock

describe('isTokenIatAcceptable (Issue #135)', () => {
  const tokenIat = 1_700_000_000 // arbitrary seconds-since-epoch
  const tokenIatMs = tokenIat * 1000

  describe('passwordChangedAt is null/undefined', () => {
    it('accepts any token when passwordChangedAt is null', () => {
      expect(isTokenIatAcceptable(tokenIat, null)).toBe(true)
    })

    it('accepts any token when passwordChangedAt is undefined', () => {
      expect(isTokenIatAcceptable(tokenIat, undefined)).toBe(true)
    })

    it('accepts token without iat when passwordChangedAt is null', () => {
      expect(isTokenIatAcceptable(undefined, null)).toBe(true)
    })
  })

  describe('passwordChangedAt is set', () => {
    it('accepts token issued after password change', () => {
      const passwordChangedAt = new Date(tokenIatMs - 1000) // 1s before token
      expect(isTokenIatAcceptable(tokenIat, passwordChangedAt)).toBe(true)
    })

    it('accepts token issued exactly at password change time', () => {
      const passwordChangedAt = new Date(tokenIatMs)
      expect(isTokenIatAcceptable(tokenIat, passwordChangedAt)).toBe(true)
    })

    it('rejects token issued before password change', () => {
      const passwordChangedAt = new Date(tokenIatMs + 1000) // 1s after token
      expect(isTokenIatAcceptable(tokenIat, passwordChangedAt)).toBe(false)
    })

    it('rejects token issued well before password change', () => {
      const passwordChangedAt = new Date(tokenIatMs + 86400_000) // 1 day after
      expect(isTokenIatAcceptable(tokenIat, passwordChangedAt)).toBe(false)
    })

    it('rejects token without iat when passwordChangedAt is set', () => {
      const passwordChangedAt = new Date(tokenIatMs)
      expect(isTokenIatAcceptable(undefined, passwordChangedAt)).toBe(false)
    })
  })

  describe('attack scenarios', () => {
    it('rejects a stolen JWT issued before the legitimate password change', () => {
      // Attacker stole token at time T
      // User changed password at time T+1h
      // Attacker's request comes after the password change
      const stolenIat = 1_700_000_000 // T (seconds)
      const passwordChangedAt = new Date((stolenIat + 3600) * 1000) // T+1h
      expect(isTokenIatAcceptable(stolenIat, passwordChangedAt)).toBe(false)
    })

    it('continues to honour fresh tokens after password change', () => {
      // User changes password at T, then logs back in at T+5min, getting a
      // fresh token. The fresh token should remain valid.
      const passwordChangedAt = new Date(1_700_000_000 * 1000) // T
      const freshIat = 1_700_000_000 + 300 // T+5min (seconds)
      expect(isTokenIatAcceptable(freshIat, passwordChangedAt)).toBe(true)
    })
  })
})

describe('refreshJwtFromUser (Issue #173)', () => {
  const tokenIat = 1_700_000_000

  beforeEach(() => {
    mockedAdminFind.mockReset()
    mockedWhitelistFind.mockReset()
  })

  it('returns null when userId is empty', async () => {
    const result = await refreshJwtFromUser('', true, tokenIat)
    expect(result).toBeNull()
    // Neither table should be queried for an empty userId.
    expect(mockedAdminFind).not.toHaveBeenCalled()
    expect(mockedWhitelistFind).not.toHaveBeenCalled()
  })

  describe('isAdminHint = true', () => {
    it('returns refreshed values when the admin row exists', async () => {
      mockedAdminFind.mockResolvedValueOnce({
        mustChangePassword: false,
        twoFactorEnabled: true,
        lastTwoFactorVerifiedAt: new Date(tokenIat * 1000),
        passwordChangedAt: null,
      })

      const result = await refreshJwtFromUser('admin-1', true, tokenIat)

      expect(result).toEqual({
        isAdmin: true,
        mustChangePassword: false,
        twoFactorEnabled: true,
        lastTwoFactorVerifiedAt: new Date(tokenIat * 1000),
      })
      // Only the admin table is queried — whitelist remains untouched.
      expect(mockedWhitelistFind).not.toHaveBeenCalled()
    })

    it('reflects admin-driven changes to mustChangePassword and twoFactorEnabled', async () => {
      mockedAdminFind.mockResolvedValueOnce({
        mustChangePassword: true,
        twoFactorEnabled: false,
        lastTwoFactorVerifiedAt: null,
        passwordChangedAt: null,
      })

      const result = await refreshJwtFromUser('admin-1', true, tokenIat)

      expect(result?.mustChangePassword).toBe(true)
      expect(result?.twoFactorEnabled).toBe(false)
    })

    it('returns null when the admin was demoted (no admin row)', async () => {
      // Admin demotion: the row is removed from the admin table, so the
      // stale "isAdmin: true" token claim no longer matches any row.
      mockedAdminFind.mockResolvedValueOnce(null)

      const result = await refreshJwtFromUser('admin-1', true, tokenIat)

      expect(result).toBeNull()
      // Whitelist lookup is intentionally not attempted — the caller will
      // strip identity and the user re-authenticates next request.
      expect(mockedWhitelistFind).not.toHaveBeenCalled()
    })

    it('rejects the token when iat predates passwordChangedAt (Issue #135)', async () => {
      mockedAdminFind.mockResolvedValueOnce({
        mustChangePassword: false,
        twoFactorEnabled: false,
        lastTwoFactorVerifiedAt: null,
        passwordChangedAt: new Date((tokenIat + 3600) * 1000), // 1h after iat
      })

      const result = await refreshJwtFromUser('admin-1', true, tokenIat)

      expect(result).toBeNull()
    })

    it('coerces null twoFactorEnabled to false', async () => {
      // Defense in depth: even if the column was somehow null, the
      // returned shape must use a strict boolean.
      mockedAdminFind.mockResolvedValueOnce({
        mustChangePassword: false,
        twoFactorEnabled: null,
        lastTwoFactorVerifiedAt: null,
        passwordChangedAt: null,
      })

      const result = await refreshJwtFromUser('admin-1', true, tokenIat)

      expect(result?.twoFactorEnabled).toBe(false)
    })
  })

  describe('isAdminHint = false', () => {
    it('returns refreshed values when the whitelist row exists', async () => {
      mockedWhitelistFind.mockResolvedValueOnce({
        mustChangePassword: true,
        twoFactorEnabled: false,
        lastTwoFactorVerifiedAt: null,
        passwordChangedAt: null,
      })

      const result = await refreshJwtFromUser('user-1', false, tokenIat)

      expect(result).toEqual({
        isAdmin: false,
        mustChangePassword: true,
        twoFactorEnabled: false,
        lastTwoFactorVerifiedAt: null,
      })
      expect(mockedAdminFind).not.toHaveBeenCalled()
    })

    it('returns null when the whitelist user no longer exists', async () => {
      mockedWhitelistFind.mockResolvedValueOnce(null)

      const result = await refreshJwtFromUser('user-1', false, tokenIat)

      expect(result).toBeNull()
    })

    it('rejects the token when iat predates passwordChangedAt', async () => {
      mockedWhitelistFind.mockResolvedValueOnce({
        mustChangePassword: false,
        twoFactorEnabled: false,
        lastTwoFactorVerifiedAt: null,
        passwordChangedAt: new Date((tokenIat + 1) * 1000), // 1s after iat
      })

      const result = await refreshJwtFromUser('user-1', false, tokenIat)

      expect(result).toBeNull()
    })
  })

  describe('attack and admin-action scenarios', () => {
    it('admin revokes admin role -> session invalidated on next request', async () => {
      // Pre-condition: the JWT was issued while the user was admin.
      // Admin removes them from the admin table.
      mockedAdminFind.mockResolvedValueOnce(null)

      const result = await refreshJwtFromUser('revoked-1', true, tokenIat)

      expect(result).toBeNull()
    })

    it('admin disables 2FA -> twoFactorEnabled reflects the new state', async () => {
      mockedAdminFind.mockResolvedValueOnce({
        mustChangePassword: false,
        twoFactorEnabled: false,
        lastTwoFactorVerifiedAt: null,
        passwordChangedAt: null,
      })

      const result = await refreshJwtFromUser('admin-1', true, tokenIat)

      expect(result?.twoFactorEnabled).toBe(false)
    })

    it('admin sets mustChangePassword=true -> reflected on next request', async () => {
      mockedWhitelistFind.mockResolvedValueOnce({
        mustChangePassword: true,
        twoFactorEnabled: false,
        lastTwoFactorVerifiedAt: null,
        passwordChangedAt: null,
      })

      const result = await refreshJwtFromUser('user-1', false, tokenIat)

      expect(result?.mustChangePassword).toBe(true)
    })
  })
})
