/**
 * Session validation helpers for invalidating JWTs after password change (Issue #135)
 *
 * When a user changes their password, all previously-issued JWTs should be
 * rejected so a stolen token cannot continue to be used. This is achieved by:
 *  1. Storing `passwordChangedAt` on the user record at password change time.
 *  2. On every JWT validation, comparing the token's `iat` (issued-at) with
 *     the user's current `passwordChangedAt`. If the token predates the
 *     password change, it is considered invalid.
 *
 * Backward compatibility: users that have never changed their password since
 * this column was added have `passwordChangedAt = null`, in which case the
 * check always passes (no constraint).
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
 * Look up the user's `passwordChangedAt` and decide whether the JWT is still
 * acceptable. Queries only the table indicated by `isAdmin` to keep this a
 * single indexed lookup per request.
 */
export async function isJwtValidForUser(
  userId: string,
  isAdmin: boolean,
  tokenIatSeconds: number | undefined,
): Promise<boolean> {
  if (!userId) return false

  let passwordChangedAt: Date | null = null
  if (isAdmin) {
    const admin = await prisma.admin.findUnique({
      where: { id: userId },
      select: { passwordChangedAt: true },
    })
    if (!admin) return false
    passwordChangedAt = admin.passwordChangedAt
  } else {
    const user = await prisma.whitelistUser.findUnique({
      where: { id: userId },
      select: { passwordChangedAt: true },
    })
    if (!user) return false
    passwordChangedAt = user.passwordChangedAt
  }

  return isTokenIatAcceptable(tokenIatSeconds, passwordChangedAt)
}
