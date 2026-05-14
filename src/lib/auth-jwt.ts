/**
 * JWT callback for NextAuth (Issue #173 / #135).
 *
 * Lives in its own module so it can be unit-tested without booting the
 * NextAuth runtime in `auth.ts`. The function is bound into the authConfig
 * at `src/lib/auth.ts`.
 *
 * Responsibilities:
 *  - On initial sign-in (the `user` parameter is set), seed token claims
 *    from the value returned by `authorize()`.
 *  - On every subsequent validation, mirror security-critical fields from
 *    the database onto the token via `refreshJwtFromUser`. This makes
 *    admin-driven changes (role revoke, 2FA disable, mustChangePassword
 *    set) take effect on the next request rather than waiting for token
 *    expiry (#173).
 *  - Reject tokens whose `iat` predates the user's `passwordChangedAt`
 *    (#135), by clearing identity claims so downstream guards treat the
 *    request as unauthenticated.
 *  - Honour the client-driven 5-minute 2FA verification window only when
 *    the server has actually recorded a recent verification (#123).
 */

import { refreshJwtFromUser } from '@/lib/session-validation'
import type { User } from 'next-auth'
import type { JWT } from 'next-auth/jwt'

export async function jwtCallback({
  token,
  user,
  trigger,
  session: updateData,
}: {
  token: JWT
  user?: User
  trigger?: 'signIn' | 'signUp' | 'update'
  session?: unknown
}): Promise<JWT> {
  // Initial sign-in: seed the token from authorize()'s return value and
  // return immediately.
  //
  // The refresh path below depends on `token.iat`, but NextAuth populates
  // `iat` *after* this callback returns on the first call. Feeding an
  // undefined `iat` into `refreshJwtFromUser` makes `isTokenIatAcceptable`
  // reject the token for any user whose `passwordChangedAt` is set,
  // locking them out the moment they re-authenticate (regression caught
  // in PR #220 review). authorize() has just read the DB, so the values
  // we seeded are current — there is nothing to refresh on this hop.
  if (user) {
    ;(token as Record<string, unknown>).isAdmin = user.isAdmin
    ;(token as Record<string, unknown>).mustChangePassword =
      user.mustChangePassword
    ;(token as Record<string, unknown>).twoFactorEnabled = user.twoFactorEnabled
    ;(token as Record<string, unknown>).requiresTwoFactor =
      user.requiresTwoFactor
    return token
  }

  if (!token.sub) return token

  const isAdminHint = (token as Record<string, unknown>).isAdmin === true
  const tokenIatSec = typeof token.iat === 'number' ? token.iat : undefined
  const refreshed = await refreshJwtFromUser(
    token.sub,
    isAdminHint,
    tokenIatSec,
  )

  if (!refreshed) {
    // User no longer exists, was demoted out of the expected table, or the
    // token predates a password change (#135). Strip identity so downstream
    // guards treat the request as unauthenticated.
    return {
      ...token,
      sub: undefined,
      isAdmin: false,
      mustChangePassword: false,
      twoFactorEnabled: false,
      requiresTwoFactor: false,
    } as JWT
  }

  const wasTwoFactorEnabled =
    (token as Record<string, unknown>).twoFactorEnabled === true

  ;(token as Record<string, unknown>).isAdmin = refreshed.isAdmin
  ;(token as Record<string, unknown>).mustChangePassword =
    refreshed.mustChangePassword
  ;(token as Record<string, unknown>).twoFactorEnabled =
    refreshed.twoFactorEnabled

  // requiresTwoFactor transitions driven by DB state:
  //  - admin disabled the user's 2FA => clear the requirement so the user
  //    is not locked out of every gated route until they re-login.
  //  - 2FA was just enabled while a session was active => require a fresh
  //    verification before granting access.
  //  - otherwise preserve the existing flag so the 5-minute verification
  //    window granted by `trigger === 'update'` is not erased.
  if (!refreshed.twoFactorEnabled) {
    ;(token as Record<string, unknown>).requiresTwoFactor = false
  } else if (!wasTwoFactorEnabled) {
    ;(token as Record<string, unknown>).requiresTwoFactor = true
  }

  // Client-driven session refresh after 2FA verification (#123). Clearing
  // requiresTwoFactor here is conditional on the server having recorded a
  // verification within the last 5 minutes so a client-forged
  // `twoFactorVerified` cannot bypass 2FA.
  if (
    trigger === 'update' &&
    refreshed.twoFactorEnabled &&
    updateData &&
    typeof updateData === 'object' &&
    'twoFactorVerified' in updateData &&
    (updateData as { twoFactorVerified?: unknown }).twoFactorVerified ===
      true &&
    refreshed.lastTwoFactorVerifiedAt &&
    Date.now() - refreshed.lastTwoFactorVerifiedAt.getTime() < 5 * 60 * 1000
  ) {
    ;(token as Record<string, unknown>).requiresTwoFactor = false
  }

  return token
}
