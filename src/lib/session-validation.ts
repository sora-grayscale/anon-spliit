/**
 * Session validation helpers for the JWT callback (Issues #135, #173).
 *
 * Two concerns live here:
 *
 *  1. Invalidating JWTs after a password change (#135). When a user changes
 *     their password, all previously-issued JWTs should be rejected so a
 *     stolen token cannot continue to be used. This is achieved by storing
 *     `passwordChangedAt` on the user record at password change time and
 *     comparing it to the token's `iat` (issued-at) on every validation.
 *
 *  2. Reflecting admin-driven changes on the next request (#173). The JWT
 *     stays alive until token expiry, so admin actions that revoke the
 *     admin role, disable a user's 2FA, or set `mustChangePassword` would
 *     otherwise not take effect until the user re-authenticates. We refresh
 *     these security-critical fields from the database on every JWT
 *     validation. This piggy-backs on the same DB lookup that #135 already
 *     performed, so no additional round trip is added.
 *
 * Backward compatibility for #135: users that have never changed their
 * password since the column was added have `passwordChangedAt = null`, in
 * which case the timestamp check always passes.
 */

import { prisma } from './prisma'

/**
 * Decide whether a JWT remains valid given the user's `passwordChangedAt`.
 *
 * Pure function for testability — does not perform DB access.
 *
 * @param tokenIatSeconds - JWT `iat` claim (seconds since epoch)
 * @param passwordChangedAt - User's `passwordChangedAt`, may be null
 * @returns true if the token is still acceptable, false if it should be rejected
 */
export function isTokenIatAcceptable(
  tokenIatSeconds: number | undefined,
  passwordChangedAt: Date | null | undefined,
): boolean {
  // No constraint set => token always acceptable
  if (!passwordChangedAt) return true
  // Token without iat cannot be validated — reject conservatively
  if (typeof tokenIatSeconds !== 'number') return false
  return tokenIatSeconds * 1000 >= passwordChangedAt.getTime()
}

/**
 * Snapshot of the security-critical user fields the JWT callback overlays
 * onto the token on every validation.
 */
export type RefreshedUser = {
  isAdmin: boolean
  mustChangePassword: boolean
  twoFactorEnabled: boolean
  lastTwoFactorVerifiedAt: Date | null
}

/**
 * Look up the user indicated by the JWT and return the current values for
 * the security-critical fields the JWT callback mirrors into the token.
 *
 * Returns `null` (= reject the token) when:
 *  - `userId` is empty.
 *  - The user no longer exists in the table indicated by `isAdminHint`. For
 *    `isAdminHint === true` this includes admin demotion (admin row deleted
 *    or moved to whitelist).
 *  - The token's `iat` predates the user's `passwordChangedAt` (#135).
 *
 * `isAdmin` in the result is derived from which table the lookup succeeded
 * in, not from the (possibly stale) token claim.
 *
 * Queries only the one table indicated by `isAdminHint` to keep this a
 * single indexed lookup per request.
 */
export async function refreshJwtFromUser(
  userId: string,
  isAdminHint: boolean,
  tokenIatSeconds: number | undefined,
): Promise<RefreshedUser | null> {
  if (!userId) return null

  if (isAdminHint) {
    const admin = await prisma.admin.findUnique({
      where: { id: userId },
      select: {
        mustChangePassword: true,
        twoFactorEnabled: true,
        lastTwoFactorVerifiedAt: true,
        passwordChangedAt: true,
      },
    })
    if (!admin) return null
    if (!isTokenIatAcceptable(tokenIatSeconds, admin.passwordChangedAt)) {
      return null
    }
    return {
      isAdmin: true,
      mustChangePassword: admin.mustChangePassword,
      twoFactorEnabled: admin.twoFactorEnabled ?? false,
      lastTwoFactorVerifiedAt: admin.lastTwoFactorVerifiedAt ?? null,
    }
  }

  const user = await prisma.whitelistUser.findUnique({
    where: { id: userId },
    select: {
      mustChangePassword: true,
      twoFactorEnabled: true,
      lastTwoFactorVerifiedAt: true,
      passwordChangedAt: true,
    },
  })
  if (!user) return null
  if (!isTokenIatAcceptable(tokenIatSeconds, user.passwordChangedAt)) {
    return null
  }
  return {
    isAdmin: false,
    mustChangePassword: user.mustChangePassword,
    twoFactorEnabled: user.twoFactorEnabled ?? false,
    lastTwoFactorVerifiedAt: user.lastTwoFactorVerifiedAt ?? null,
  }
}
