/**
 * Authentication helpers for REST API route handlers.
 *
 * These helpers mirror the equivalent checks in tRPC procedures
 * (`src/trpc/init.ts`) so REST API routes cannot be used to bypass them.
 */

import type { Session } from 'next-auth'
import { NextResponse } from 'next/server'

/**
 * Returns a 403 NextResponse if the session indicates the user must change
 * their password before performing other actions, or null otherwise.
 *
 * Mirrors the `mustChangePassword` check in publicProcedure / adminProcedure
 * (Issue #142). The change-password endpoint and the pre-auth 2FA verify
 * endpoint (which has no session) are intentionally exempt and should not
 * call this helper.
 */
export function passwordChangeRequiredResponse(
  session: Session | null,
): NextResponse | null {
  if (session?.user?.mustChangePassword) {
    return NextResponse.json(
      { error: 'Password change required' },
      { status: 403 },
    )
  }
  return null
}
