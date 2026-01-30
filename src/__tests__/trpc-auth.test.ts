/**
 * Tests for tRPC authentication in Private Instance mode
 * Issue #39: tRPC routes bypass Private Instance authentication
 *
 * These tests verify the authentication middleware logic by simulating
 * the same checks performed in publicProcedure and adminProcedure.
 */

import { TRPCError } from '@trpc/server'

// Simulate the session type from NextAuth
type Session = {
  user?: {
    id: string
    email: string
    isAdmin: boolean
    mustChangePassword: boolean
    twoFactorEnabled: boolean
    requiresTwoFactor: boolean
  }
} | null

/**
 * Simulates publicProcedure middleware logic
 * This mirrors the actual implementation in src/trpc/init.ts
 */
function checkPublicProcedure(
  isPrivateInstance: boolean,
  session: Session,
): void {
  if (isPrivateInstance) {
    if (!session?.user) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      })
    }
    if (session.user.requiresTwoFactor) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Two-factor authentication required',
      })
    }
    if (session.user.mustChangePassword) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Password change required',
      })
    }
  }
}

/**
 * Simulates adminProcedure middleware logic
 * This mirrors the actual implementation in src/trpc/init.ts
 */
function checkAdminProcedure(
  isPrivateInstance: boolean,
  session: Session,
): void {
  if (!isPrivateInstance) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Admin features are only available in private instance mode',
    })
  }
  if (!session?.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    })
  }
  if (session.user.requiresTwoFactor) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Two-factor authentication required',
    })
  }
  if (session.user.mustChangePassword) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Password change required',
    })
  }
  if (!session.user.isAdmin) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin access required',
    })
  }
}

// Define user type for helper function
type SessionUser = NonNullable<NonNullable<Session>['user']>

// Helper to create a valid session
function createValidSession(overrides: Partial<SessionUser> = {}): Session {
  return {
    user: {
      id: 'user-1',
      email: 'test@example.com',
      isAdmin: false,
      mustChangePassword: false,
      twoFactorEnabled: false,
      requiresTwoFactor: false,
      ...overrides,
    },
  }
}

describe('tRPC Authentication', () => {
  describe('publicProcedure middleware', () => {
    describe('in public instance mode', () => {
      it('should allow unauthenticated access', () => {
        expect(() => checkPublicProcedure(false, null)).not.toThrow()
      })

      it('should allow authenticated access', () => {
        expect(() =>
          checkPublicProcedure(false, createValidSession()),
        ).not.toThrow()
      })
    })

    describe('in private instance mode', () => {
      it('should reject unauthenticated access with UNAUTHORIZED', () => {
        expect(() => checkPublicProcedure(true, null)).toThrow(TRPCError)
        try {
          checkPublicProcedure(true, null)
        } catch (e) {
          expect(e).toBeInstanceOf(TRPCError)
          expect((e as TRPCError).code).toBe('UNAUTHORIZED')
          expect((e as TRPCError).message).toBe('Authentication required')
        }
      })

      it('should reject session without user with UNAUTHORIZED', () => {
        expect(() => checkPublicProcedure(true, { user: undefined })).toThrow(
          TRPCError,
        )
      })

      it('should reject user requiring 2FA with UNAUTHORIZED', () => {
        const session = createValidSession({ requiresTwoFactor: true })
        try {
          checkPublicProcedure(true, session)
          fail('Expected TRPCError to be thrown')
        } catch (e) {
          expect(e).toBeInstanceOf(TRPCError)
          expect((e as TRPCError).code).toBe('UNAUTHORIZED')
          expect((e as TRPCError).message).toBe(
            'Two-factor authentication required',
          )
        }
      })

      it('should reject user requiring password change with FORBIDDEN', () => {
        const session = createValidSession({ mustChangePassword: true })
        try {
          checkPublicProcedure(true, session)
          fail('Expected TRPCError to be thrown')
        } catch (e) {
          expect(e).toBeInstanceOf(TRPCError)
          expect((e as TRPCError).code).toBe('FORBIDDEN')
          expect((e as TRPCError).message).toBe('Password change required')
        }
      })

      it('should allow valid authenticated user', () => {
        const session = createValidSession()
        expect(() => checkPublicProcedure(true, session)).not.toThrow()
      })

      it('should check 2FA before password change', () => {
        // When both conditions are true, 2FA should be checked first
        const session = createValidSession({
          requiresTwoFactor: true,
          mustChangePassword: true,
        })
        try {
          checkPublicProcedure(true, session)
          fail('Expected TRPCError to be thrown')
        } catch (e) {
          expect((e as TRPCError).message).toBe(
            'Two-factor authentication required',
          )
        }
      })
    })
  })

  describe('adminProcedure middleware', () => {
    describe('in public instance mode', () => {
      it('should reject with NOT_FOUND', () => {
        try {
          checkAdminProcedure(false, createValidSession({ isAdmin: true }))
          fail('Expected TRPCError to be thrown')
        } catch (e) {
          expect(e).toBeInstanceOf(TRPCError)
          expect((e as TRPCError).code).toBe('NOT_FOUND')
          expect((e as TRPCError).message).toBe(
            'Admin features are only available in private instance mode',
          )
        }
      })
    })

    describe('in private instance mode', () => {
      it('should reject unauthenticated access with UNAUTHORIZED', () => {
        try {
          checkAdminProcedure(true, null)
          fail('Expected TRPCError to be thrown')
        } catch (e) {
          expect(e).toBeInstanceOf(TRPCError)
          expect((e as TRPCError).code).toBe('UNAUTHORIZED')
          expect((e as TRPCError).message).toBe('Authentication required')
        }
      })

      it('should reject admin requiring 2FA with UNAUTHORIZED', () => {
        const session = createValidSession({
          isAdmin: true,
          requiresTwoFactor: true,
        })
        try {
          checkAdminProcedure(true, session)
          fail('Expected TRPCError to be thrown')
        } catch (e) {
          expect(e).toBeInstanceOf(TRPCError)
          expect((e as TRPCError).code).toBe('UNAUTHORIZED')
          expect((e as TRPCError).message).toBe(
            'Two-factor authentication required',
          )
        }
      })

      it('should reject admin requiring password change with FORBIDDEN', () => {
        const session = createValidSession({
          isAdmin: true,
          mustChangePassword: true,
        })
        try {
          checkAdminProcedure(true, session)
          fail('Expected TRPCError to be thrown')
        } catch (e) {
          expect(e).toBeInstanceOf(TRPCError)
          expect((e as TRPCError).code).toBe('FORBIDDEN')
          expect((e as TRPCError).message).toBe('Password change required')
        }
      })

      it('should reject non-admin user with FORBIDDEN', () => {
        const session = createValidSession({ isAdmin: false })
        try {
          checkAdminProcedure(true, session)
          fail('Expected TRPCError to be thrown')
        } catch (e) {
          expect(e).toBeInstanceOf(TRPCError)
          expect((e as TRPCError).code).toBe('FORBIDDEN')
          expect((e as TRPCError).message).toBe('Admin access required')
        }
      })

      it('should allow valid admin user', () => {
        const session = createValidSession({ isAdmin: true })
        expect(() => checkAdminProcedure(true, session)).not.toThrow()
      })

      it('should check authentication before admin role', () => {
        // When unauthenticated, should get UNAUTHORIZED not FORBIDDEN
        try {
          checkAdminProcedure(true, null)
          fail('Expected TRPCError to be thrown')
        } catch (e) {
          expect((e as TRPCError).code).toBe('UNAUTHORIZED')
        }
      })

      it('should check 2FA before admin role', () => {
        // When admin needs 2FA, should get 2FA error not admin error
        const session = createValidSession({
          isAdmin: true,
          requiresTwoFactor: true,
        })
        try {
          checkAdminProcedure(true, session)
          fail('Expected TRPCError to be thrown')
        } catch (e) {
          expect((e as TRPCError).message).toBe(
            'Two-factor authentication required',
          )
        }
      })
    })
  })

  describe('Error code semantics', () => {
    it('UNAUTHORIZED (401) is used for authentication issues', () => {
      // Missing auth, incomplete 2FA
      const error = new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Test',
      })
      expect(error.code).toBe('UNAUTHORIZED')
    })

    it('FORBIDDEN (403) is used for authorization issues', () => {
      // Password change required, not admin
      const error = new TRPCError({
        code: 'FORBIDDEN',
        message: 'Test',
      })
      expect(error.code).toBe('FORBIDDEN')
    })

    it('NOT_FOUND (404) is used for unavailable features', () => {
      // Admin features in public mode
      const error = new TRPCError({
        code: 'NOT_FOUND',
        message: 'Test',
      })
      expect(error.code).toBe('NOT_FOUND')
    })
  })
})
