/**
 * Client-only module store coordinating the 2FA verification transaction
 * across the TOTP page and the backup-code page.
 *
 * Two pieces of state:
 *
 * - A single exclusive **lease**: exactly one verification transaction may
 *   run at a time across BOTH pages. `tryAcquireTwoFactorLease` never steals
 *   an active lease — a second submit while one is in flight joins it as a
 *   no-op (the in-flight transaction drives the navigation). A transaction
 *   must re-check ownership after every await; a non-owner must not call
 *   `update()`, consume the pending fragment, or navigate. Ownership is only
 *   ended by the owner itself or by `invalidateTwoFactorFlow`, which
 *   TwoFactorGuard calls synchronously (layout effect) on the first commit
 *   outside the verify flow. Pages never release the lease on unmount: the
 *   transaction outlives a TOTP <-> backup page switch by design.
 *
 * - A **recovery outcome** bound to the verified subject ({id, isAdmin} —
 *   emails are not unique across the Admin and WhitelistUser tables):
 *   'outcomeUnknown' from the moment a code is dispatched until the server's
 *   answer is known (a rejected fetch or a 5xx may have committed
 *   server-side), 'serverVerified' once a 2xx was observed. Either state
 *   makes the next submit retry the session sync FIRST instead of re-sending
 *   a code — for backup codes a resend would burn a second code or fail on
 *   the consumed one. The dispatched token is remembered so an unknown
 *   outcome never auto-resends the same code. The outcome survives
 *   `invalidateTwoFactorFlow` so a user bounced back into the flow can still
 *   recover; it holds a short-lived one-time code (never E2EE key material)
 *   and is cleared when the flow completes or definitively fails.
 */

export interface VerifySubject {
  id: string
  isAdmin: boolean
}

export type VerifyOutcome = 'idle' | 'outcomeUnknown' | 'serverVerified'

let leaseSeq = 0
let activeLease: number | null = null

let outcome: VerifyOutcome = 'idle'
let outcomeSubjectKey: string | null = null
let dispatchedToken: string | null = null

function subjectKey(subject: VerifySubject): string {
  return `${subject.isAdmin ? 'admin' : 'user'}:${subject.id}`
}

export function tryAcquireTwoFactorLease(): number | null {
  // Client-only: a server-side lease would be shared across every request
  // handled by the Node process.
  if (typeof window === 'undefined') return null
  if (activeLease !== null) return null
  activeLease = ++leaseSeq
  return activeLease
}

export function isTwoFactorLeaseOwner(lease: number | null): boolean {
  return lease !== null && activeLease === lease
}

export function releaseTwoFactorLease(lease: number | null): void {
  if (isTwoFactorLeaseOwner(lease)) {
    activeLease = null
  }
}

export function invalidateTwoFactorFlow(): void {
  // Leaving the verify flow ends any transaction: surviving closures lose
  // ownership and their continuations become no-ops. The recovery outcome is
  // intentionally kept (see module doc).
  activeLease = null
}

/** True when `path`'s path portion is inside the verify flow. */
export function isVerifyFlowPath(path: string): boolean {
  const pathOnly = path.split(/[?#]/)[0]
  return (
    pathOnly === '/auth/verify-2fa' || pathOnly.startsWith('/auth/verify-2fa/')
  )
}

/** Owner-only: a code was sent; the server's answer is not known yet. */
export function markVerifyDispatched(
  lease: number | null,
  subject: VerifySubject,
  token: string,
): void {
  if (!isTwoFactorLeaseOwner(lease)) return
  outcome = 'outcomeUnknown'
  outcomeSubjectKey = subjectKey(subject)
  dispatchedToken = token
}

/** Owner-only: a 2xx was observed — the server committed the verification. */
export function markVerifyServerVerified(
  lease: number | null,
  subject: VerifySubject,
): void {
  if (!isTwoFactorLeaseOwner(lease)) return
  outcome = 'serverVerified'
  outcomeSubjectKey = subjectKey(subject)
}

/** Owner-only: the flow completed or the server definitively rejected. */
export function markVerifyIdle(lease: number | null): void {
  if (!isTwoFactorLeaseOwner(lease)) return
  outcome = 'idle'
  outcomeSubjectKey = null
  dispatchedToken = null
}

export function getVerifyOutcome(subject: VerifySubject): VerifyOutcome {
  if (outcome === 'idle' || outcomeSubjectKey !== subjectKey(subject)) {
    return 'idle'
  }
  return outcome
}

/** True when `token` is the code whose dispatch produced the current outcome. */
export function wasVerifyTokenDispatched(
  subject: VerifySubject,
  token: string,
): boolean {
  return (
    outcome !== 'idle' &&
    outcomeSubjectKey === subjectKey(subject) &&
    dispatchedToken === token
  )
}
