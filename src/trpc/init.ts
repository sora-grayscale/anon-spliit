import { auth, isPrivateInstance } from '@/lib/auth'
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
