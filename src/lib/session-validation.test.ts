import { isTokenIatAcceptable } from './session-validation'

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
