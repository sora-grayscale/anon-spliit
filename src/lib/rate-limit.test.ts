/**
 * Rate limiter tests (Issue #41)
 *
 * Tests for both in-memory (default) and database storage backends.
 * Database storage tests are skipped unless the table exists.
 */

import {
  checkRateLimit,
  checkRateLimitAsync,
  clearAttempts,
  clearAttemptsAsync,
  getRateLimitConfig,
  getStorageType,
  recordFailedAttempt,
  recordFailedAttemptAsync,
} from './rate-limit'

describe('rate-limit', () => {
  const testEmail = 'test@example.com'

  beforeEach(() => {
    // Clear attempts before each test
    clearAttempts(testEmail)
  })

  describe('checkRateLimit', () => {
    it('should allow first attempt', () => {
      const result = checkRateLimit(testEmail)
      expect(result.isLimited).toBe(false)
      expect(result.remainingAttempts).toBe(5)
    })

    it('should track remaining attempts after failures', () => {
      recordFailedAttempt(testEmail)
      const result = checkRateLimit(testEmail)
      expect(result.isLimited).toBe(false)
      expect(result.remainingAttempts).toBe(4)
    })

    it('should limit after max attempts', () => {
      const { maxAttempts } = getRateLimitConfig()

      // Record max failed attempts
      for (let i = 0; i < maxAttempts; i++) {
        recordFailedAttempt(testEmail)
      }

      const result = checkRateLimit(testEmail)
      expect(result.isLimited).toBe(true)
      expect(result.retryAfter).toBeGreaterThan(0)
    })

    it('should be case insensitive', () => {
      recordFailedAttempt('TEST@EXAMPLE.COM')
      const result = checkRateLimit('test@example.com')
      expect(result.remainingAttempts).toBe(4)
    })
  })

  describe('recordFailedAttempt', () => {
    it('should increment attempt count', () => {
      recordFailedAttempt(testEmail)
      recordFailedAttempt(testEmail)

      const result = checkRateLimit(testEmail)
      expect(result.remainingAttempts).toBe(3) // 5 - 2 = 3
    })
  })

  describe('clearAttempts', () => {
    it('should reset attempts on successful login', () => {
      // Record some failed attempts
      recordFailedAttempt(testEmail)
      recordFailedAttempt(testEmail)

      // Verify attempts recorded
      let result = checkRateLimit(testEmail)
      expect(result.remainingAttempts).toBe(3)

      // Clear attempts (simulating successful login)
      clearAttempts(testEmail)

      // Should be back to full attempts
      result = checkRateLimit(testEmail)
      expect(result.isLimited).toBe(false)
      expect(result.remainingAttempts).toBe(5)
    })
  })

  describe('getRateLimitConfig', () => {
    it('should return configuration values', () => {
      const config = getRateLimitConfig()
      expect(config.maxAttempts).toBe(5)
      expect(config.windowMs).toBe(15 * 60 * 1000)
      expect(config.lockoutMs).toBe(30 * 60 * 1000)
    })
  })

  describe('getStorageType', () => {
    it('should return storage type string', () => {
      const type = getStorageType()
      expect(['memory', 'database', 'auto']).toContain(type)
    })
  })

  describe('async API', () => {
    const asyncEmail = 'async-test@example.com'

    beforeEach(async () => {
      await clearAttemptsAsync(asyncEmail)
    })

    it('should work with async check', async () => {
      const result = await checkRateLimitAsync(asyncEmail)
      expect(result.isLimited).toBe(false)
      expect(result.remainingAttempts).toBe(5)
    })

    it('should track attempts with async record', async () => {
      await recordFailedAttemptAsync(asyncEmail)
      const result = await checkRateLimitAsync(asyncEmail)
      expect(result.remainingAttempts).toBe(4)
    })

    it('should clear attempts with async clear', async () => {
      await recordFailedAttemptAsync(asyncEmail)
      await recordFailedAttemptAsync(asyncEmail)

      let result = await checkRateLimitAsync(asyncEmail)
      expect(result.remainingAttempts).toBe(3)

      await clearAttemptsAsync(asyncEmail)

      result = await checkRateLimitAsync(asyncEmail)
      expect(result.remainingAttempts).toBe(5)
    })
  })

  describe('backward compatibility', () => {
    it('should export sync functions', () => {
      expect(typeof checkRateLimit).toBe('function')
      expect(typeof recordFailedAttempt).toBe('function')
      expect(typeof clearAttempts).toBe('function')
      expect(typeof getRateLimitConfig).toBe('function')
    })

    it('should export async functions', () => {
      expect(typeof checkRateLimitAsync).toBe('function')
      expect(typeof recordFailedAttemptAsync).toBe('function')
      expect(typeof clearAttemptsAsync).toBe('function')
    })

    it('should export storage type function', () => {
      expect(typeof getStorageType).toBe('function')
    })
  })
})
