import { auth, isPrivateInstance } from '@/lib/auth'
import {
  checkOperationRateLimit,
  recordOperationAttempt,
} from '@/lib/rate-limit'
import { Prisma } from '@prisma/client'
import { initTRPC, TRPCError } from '@trpc/server'
import { cache } from 'react'
import superjson from 'superjson'

superjson.registerCustom<Prisma.Decimal, string>(
  {
    isApplicable: (v): v is Prisma.Decimal => Prisma.Decimal.isDecimal(v),
    serialize: (v) => v.toJSON(),
    deserialize: (v) => new Prisma.Decimal(v),
  },
  'decimal.js',
)

export const createTRPCContext = cache(async () => {
  /**
   * @see: https://trpc.io/docs/server/context
   */
  const session = isPrivateInstance() ? await auth() : null
  return { session }
})

type Context = Awaited<ReturnType<typeof createTRPCContext>>

// Avoid exporting the entire t-object
// since it's not very descriptive.
// For instance, the use of a t variable
// is common in i18n libraries.
const t = initTRPC.context<Context>().create({
  /**
   * @see https://trpc.io/docs/server/data-transformers
   */
  transformer: superjson,
})

// Base router and procedure helpers
export const createTRPCRouter = t.router

/**
 * Base procedure - use for internal procedures only
 */
export const baseProcedure = t.procedure

/**
 * Public procedure - requires authentication in private instance mode
 * Use this for all user-facing API endpoints
 */
export const publicProcedure = t.procedure.use(async ({ ctx, next }) => {
  // Check authentication in private instance mode
  if (isPrivateInstance()) {
    if (!ctx.session?.user) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      })
    }
    // Check if user needs to complete 2FA
    if (ctx.session.user.requiresTwoFactor) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Two-factor authentication required',
      })
    }
    // Check if user must change password (except for specific endpoints handled elsewhere)
    if (ctx.session.user.mustChangePassword) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Password change required',
      })
    }
  }
  return next({ ctx })
})

/**
 * Admin procedure - requires admin authentication
 * Use this for admin-only endpoints
 * Includes all checks from publicProcedure plus admin role verification
 */
export const adminProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!isPrivateInstance()) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Admin features are only available in private instance mode',
    })
  }
  if (!ctx.session?.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    })
  }
  // Check if user needs to complete 2FA (same as publicProcedure)
  if (ctx.session.user.requiresTwoFactor) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Two-factor authentication required',
    })
  }
  // Check if user must change password (same as publicProcedure)
  if (ctx.session.user.mustChangePassword) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Password change required',
    })
  }
  if (!ctx.session.user.isAdmin) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin access required',
    })
  }
  return next({ ctx })
})

/**
 * Rate limiting middleware factory (Issue #78)
 * Creates a middleware that rate limits operations by a key extracted from input
 *
 * @param operation - Operation name for the rate limit key (e.g., 'delete', 'create-expense')
 * @param maxAttempts - Maximum attempts allowed in the window
 * @param windowMs - Time window in milliseconds
 * @param getKey - Function to extract the rate limit key from input (default: uses groupId)
 */
export function createRateLimitMiddleware<TInput extends { groupId: string }>(
  operation: string,
  maxAttempts: number,
  windowMs: number,
) {
  return t.middleware(async ({ input, next, getRawInput }) => {
    // Use input if available, otherwise get raw input (middleware may run before .input())
    let inputData = input as TInput | undefined

    if (!inputData?.groupId) {
      // Try to get raw input if parsed input is not available
      const rawInput = await getRawInput()
      inputData = rawInput as TInput | undefined
    }

    // Skip rate limiting if no valid input (will fail at input validation anyway)
    if (!inputData?.groupId) {
      return next()
    }

    const key = `${operation}:${inputData.groupId}`

    // Check rate limit
    const { isLimited, retryAfter } = checkOperationRateLimit(
      key,
      maxAttempts,
      windowMs,
    )

    if (isLimited) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `Too many ${operation} attempts. Please try again in ${retryAfter} seconds.`,
      })
    }

    // Record attempt before executing
    recordOperationAttempt(key, maxAttempts, windowMs)

    return next()
  })
}

/**
 * Rate-limited public procedure factory
 * Creates a procedure with rate limiting applied
 */
export function createRateLimitedProcedure(
  operation: string,
  maxAttempts: number,
  windowMs: number,
) {
  return publicProcedure.use(
    createRateLimitMiddleware(operation, maxAttempts, windowMs),
  )
}
