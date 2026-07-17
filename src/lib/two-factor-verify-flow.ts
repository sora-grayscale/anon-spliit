/**
 * Client-only module store coordinating the 2FA verification transaction
 * across the TOTP page and the backup-code page.
 *
 * Three pieces of state:
 *
 * - A single exclusive **lease**, bound to the subject that acquired it:
 *   exactly one verification transaction may run at a time across BOTH
 *   pages. `tryAcquireTwoFactorLease` never steals a lease held by the SAME
 *   subject — a second submit while one is in flight joins it as a no-op
 *   (the in-flight transaction drives the navigation). A DIFFERENT subject
 *   (account switch in the same browser context, or logout — `null`)
 *   invalidates the old lease synchronously and acquires a fresh one: the
 *   previous user's transaction must not survive into the next user's
 *   session. A transaction must re-check ownership after every await; a
 *   non-owner must not call `update()`, consume the pending fragment, or
 *   navigate. Ownership is only ended by the owner itself, by a
 *   subject-change acquire, or by `invalidateTwoFactorFlow`, which
 *   TwoFactorGuard calls synchronously (layout effect) on the first commit
 *   outside the verify flow. Pages never release the lease on unmount: the
 *   transaction outlives a TOTP <-> backup page switch by design.
 *
 * - A **recovery outcome** bound to the verified subject ({id, isAdmin} —
 *   emails are not unique across the Admin and WhitelistUser tables):
 *   'outcomeUnknown' from the moment a code is dispatched until the
 *   server's answer is known, 'serverVerified' once a 2xx (or an
 *   ALREADY_VERIFIED / RETRY_SYNC rejection, which is a success in
 *   disguise) was observed. Either state makes the next submit retry the
 *   session sync FIRST instead of re-sending a code. The dispatched token
 *   is remembered so the TOTP page never auto-resends the same code.
 *   Concurrent backup-code consumption is serialized SERVER-side (CAS on
 *   the encrypted codes blob in the verify route), so no client-side
 *   transport tracking is needed. The outcome survives
 *   `invalidateTwoFactorFlow` so a user bounced back into the flow can
 *   still recover; it holds a short-lived one-time code (never E2EE key
 *   material) and is cleared when the flow completes or definitively fails.
 *
 * - A monotonically increasing **version**, exposed through a
 *   subscribe/snapshot pair for `useSyncExternalStore`: the pages' bounce/
 *   recovery effect must re-arm when the lease state changes, otherwise a
 *   page that lost a `tryAcquire` race once would never get a second chance
 *   (lost wakeup) and could render blank forever.
 */

export interface VerifySubject {
  id: string
  isAdmin: boolean
}

export type VerifyOutcome = 'idle' | 'outcomeUnknown' | 'serverVerified'

let leaseSeq = 0
let activeLease: number | null = null
let leaseSubjectKey: string | null = null

let outcome: VerifyOutcome = 'idle'
let outcomeSubjectKey: string | null = null
let dispatchedToken: string | null = null

let version = 0
const listeners = new Set<() => void>()

function bumpVersion(): void {
  version++
  listeners.forEach((listener) => listener())
}

/** Key for a subject, or for the signed-out state (`null`). */
export function verifySubjectKey(subject: VerifySubject | null): string {
  return subject === null
    ? 'anon'
    : `${subject.isAdmin ? 'admin' : 'user'}:${subject.id}`
}

export function tryAcquireTwoFactorLease(
  subject: VerifySubject | null,
): number | null {
  // Client-only: a server-side lease would be shared across every request
  // handled by the Node process.
  if (typeof window === 'undefined') return null
  const key = verifySubjectKey(subject)
  if (activeLease !== null) {
    // Same subject: join the in-flight transaction (no steal). A different
    // subject (account switch / logout) kills it synchronously instead —
    // its closures become non-owners before they can touch anything.
    if (leaseSubjectKey === key) return null
    activeLease = null
    leaseSubjectKey = null
  }
  activeLease = ++leaseSeq
  leaseSubjectKey = key
  bumpVersion()
  return activeLease
}

export function isTwoFactorLeaseOwner(lease: number | null): boolean {
  return lease !== null && activeLease === lease
}

export function releaseTwoFactorLease(lease: number | null): void {
  if (isTwoFactorLeaseOwner(lease)) {
    activeLease = null
    leaseSubjectKey = null
    bumpVersion()
  }
}

export function invalidateTwoFactorFlow(): void {
  // Leaving the verify flow ends any transaction: surviving closures lose
  // ownership and their continuations become no-ops. The recovery outcome is
  // intentionally kept (see module doc).
  if (activeLease !== null) {
    activeLease = null
    leaseSubjectKey = null
    bumpVersion()
  }
}

export function subscribeTwoFactorFlow(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getTwoFactorFlowVersion(): number {
  return version
}

export function getTwoFactorFlowServerVersion(): number {
  return 0
}

/** True when `path`'s path portion is inside the verify flow. */
export function isVerifyFlowPath(path: string): boolean {
  // WHATWG URL normalization collapses dot segments including their
  // percent-encoded forms (%2e%2e, .%2e, %2e.) — a hand-rolled split would
  // let a crafted callbackUrl sneak back into the flow and strand the lease.
  let pathOnly: string
  try {
    pathOnly = new URL(path, 'http://localhost').pathname
  } catch {
    return false
  }
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
  outcomeSubjectKey = verifySubjectKey(subject)
  dispatchedToken = token
}

/** Owner-only: the server committed the verification for this subject. */
export function markVerifyServerVerified(
  lease: number | null,
  subject: VerifySubject,
): void {
  if (!isTwoFactorLeaseOwner(lease)) return
  outcome = 'serverVerified'
  outcomeSubjectKey = verifySubjectKey(subject)
}

/** Owner-only: the flow completed or the server definitively rejected. */
export function markVerifyIdle(lease: number | null): void {
  if (!isTwoFactorLeaseOwner(lease)) return
  outcome = 'idle'
  outcomeSubjectKey = null
  dispatchedToken = null
}

export function getVerifyOutcome(subject: VerifySubject): VerifyOutcome {
  if (outcome === 'idle' || outcomeSubjectKey !== verifySubjectKey(subject)) {
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
    outcomeSubjectKey === verifySubjectKey(subject) &&
    dispatchedToken === token
  )
}
