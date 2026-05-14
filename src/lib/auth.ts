/**
 * NextAuth.js configuration for Private Instance Mode (Issue #4)
 */

import { jwtCallback } from '@/lib/auth-jwt'
import { prisma } from '@/lib/prisma'
import {
  checkRateLimitAsync,
  clearAttemptsAsync,
  recordFailedAttemptAsync,
} from '@/lib/rate-limit'
import { PrismaAdapter } from '@auth/prisma-adapter'
import bcrypt from 'bcryptjs'
import NextAuth, { type NextAuthConfig } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'

// Dummy hash for timing-safe comparison when user doesn't exist (Issue #111)
// This ensures consistent response time regardless of user existence
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing-equalization', 12)

// Extend the session type to include our custom properties
declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      name?: string | null
      isAdmin: boolean
      mustChangePassword: boolean
      twoFactorEnabled: boolean
      requiresTwoFactor: boolean
    }
  }
  interface User {
    isAdmin: boolean
    mustChangePassword: boolean
    twoFactorEnabled: boolean
    requiresTwoFactor: boolean
  }
}

const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma) as NextAuthConfig['adapter'],
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const email = credentials.email as string
        const password = credentials.password as string

        // Check rate limit before attempting authentication.
        // Use the async API so database storage (Issue #167) is respected;
        // the sync entry point silently bypasses non-memory backends.
        const rateLimit = await checkRateLimitAsync(email)
        if (rateLimit.isLimited) {
          console.warn(
            `Rate limited login attempt for ${email}. Retry after ${rateLimit.retryAfter}s`,
          )
          // Return null to indicate failed auth (NextAuth will show generic error)
          return null
        }

        // Search admin and whitelist tables in parallel to prevent
        // user enumeration via timing differences (Issue #111)
        const [admin, whitelistUser] = await Promise.all([
          prisma.admin.findUnique({ where: { email } }),
          prisma.whitelistUser.findUnique({ where: { email } }),
        ])

        if (admin) {
          const isValidPassword = await bcrypt.compare(password, admin.password)
          if (isValidPassword) {
            // Clear rate limit on successful login
            await clearAttemptsAsync(email)
            // Check if 2FA is enabled for this user
            const twoFactorEnabled = admin.twoFactorEnabled ?? false
            return {
              id: admin.id,
              email: admin.email,
              name: admin.name,
              isAdmin: true,
              mustChangePassword: admin.mustChangePassword,
              twoFactorEnabled,
              requiresTwoFactor: twoFactorEnabled,
            }
          }
        } else if (whitelistUser && whitelistUser.password) {
          const isValidPassword = await bcrypt.compare(
            password,
            whitelistUser.password,
          )
          if (isValidPassword) {
            // Clear rate limit on successful login
            await clearAttemptsAsync(email)
            // Check if 2FA is enabled for this user
            const twoFactorEnabled = whitelistUser.twoFactorEnabled ?? false
            return {
              id: whitelistUser.id,
              email: whitelistUser.email,
              name: whitelistUser.name,
              isAdmin: false,
              mustChangePassword: whitelistUser.mustChangePassword,
              twoFactorEnabled,
              requiresTwoFactor: twoFactorEnabled,
            }
          }
        } else {
          // No user found - perform dummy bcrypt comparison to equalize timing
          await bcrypt.compare(password, DUMMY_HASH)
        }

        // Record failed attempt for rate limiting
        await recordFailedAttemptAsync(email)
        return null
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    jwt: jwtCallback,
    async session({ session, token }) {
      // When the jwt callback invalidates a token (e.g. password changed after
      // issuance, Issue #135), `token.sub` is cleared. We drop `session.user`
      // entirely so callers that inspect either `session?.user` or
      // `session?.user?.id` see no authenticated user.
      if (!token.sub) {
        return {
          ...session,
          user: undefined,
        } as unknown as typeof session
      }
      if (session.user) {
        session.user.id = token.sub as string
        session.user.isAdmin =
          ((token as Record<string, unknown>).isAdmin as boolean) ?? false
        session.user.mustChangePassword =
          ((token as Record<string, unknown>).mustChangePassword as boolean) ??
          false
        session.user.twoFactorEnabled =
          ((token as Record<string, unknown>).twoFactorEnabled as boolean) ??
          false
        session.user.requiresTwoFactor =
          ((token as Record<string, unknown>).requiresTwoFactor as boolean) ??
          false
      }
      return session
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
}

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig)

/**
 * Check if private instance mode is enabled
 */
export function isPrivateInstance(): boolean {
  return process.env.PRIVATE_INSTANCE === 'true'
}

/**
 * Initialize admin user from environment variables
 * Call this on server startup if PRIVATE_INSTANCE is enabled
 */
export async function initializeAdmin(): Promise<void> {
  if (!isPrivateInstance()) {
    return
  }

  const adminEmail = process.env.ADMIN_EMAIL
  const adminPassword = process.env.ADMIN_PASSWORD

  if (!adminEmail || !adminPassword) {
    console.warn(
      'PRIVATE_INSTANCE is enabled but ADMIN_EMAIL or ADMIN_PASSWORD is not set',
    )
    return
  }

  // Check if admin already exists
  const existingAdmin = await prisma.admin.findUnique({
    where: { email: adminEmail },
  })

  if (existingAdmin) {
    return // Admin already exists
  }

  // Create initial admin with mustChangePassword flag
  const hashedPassword = await bcrypt.hash(adminPassword, 12)
  await prisma.admin.create({
    data: {
      email: adminEmail,
      password: hashedPassword,
      name: 'Admin',
      mustChangePassword: true,
    },
  })

  // Log admin creation without exposing email in production
  console.log('Initial admin account created successfully')
}

/**
 * Check if a user is authorized to access the application
 */
export async function isAuthorizedUser(email: string): Promise<boolean> {
  if (!isPrivateInstance()) {
    return true // Public instance - everyone is authorized
  }

  // Check if admin
  const admin = await prisma.admin.findUnique({
    where: { email },
  })
  if (admin) return true

  // Check if in whitelist
  const whitelistUser = await prisma.whitelistUser.findUnique({
    where: { email },
  })
  if (whitelistUser) return true

  return false
}

/**
 * Check if a user is an admin
 */
export async function isAdminUser(email: string): Promise<boolean> {
  const admin = await prisma.admin.findUnique({
    where: { email },
  })
  return !!admin
}
