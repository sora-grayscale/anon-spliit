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
 * (Issue #142). The change-password endpoint and the 2FA verify endpoint
 * (`/api/2fa/verify`) are intentionally exempt and should not call this
 * helper. The verify endpoint runs its own subject-bound pre-2FA gate
 * (Issue #174); blocking on `mustChangePassword` would self-block users
 * who must complete 2FA before reaching the change-password flow.
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

/**
 * Returns a 401 NextResponse if the session indicates the user has not yet
 * completed two-factor authentication for the current login, or null
 * otherwise.
 *
 * Mirrors the `requiresTwoFactor` check in publicProcedure / adminProcedure
 * (`src/trpc/init.ts`, Issue #166). REST API handlers must call this BEFORE
 * `passwordChangeRequiredResponse` so the 2FA gate matches the tRPC ordering.
 *
 * The 2FA verify endpoint (`/api/2fa/verify`) is intentionally exempt:
 * `requiresTwoFactor=true` is the very pre-condition that endpoint needs to
 * clear, so calling this helper would self-block the flow. That endpoint
 * performs its own subject binding via `session.user.id` + `isAdmin` and a
 * subject-id rate-limit key instead (Issue #174).
 */
export function requiresTwoFactorResponse(
  session: Session | null,
): NextResponse | null {
  if (session?.user?.requiresTwoFactor) {
    return NextResponse.json(
      { error: 'Two-factor authentication required' },
      { status: 401 },
    )
  }
  return null
}
