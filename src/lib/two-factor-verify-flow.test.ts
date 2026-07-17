/**
 * @jest-environment jsdom
 */

/**
 * Unit tests for the 2FA verify-flow store: subject-bound exclusive lease
 * semantics (join for the same subject, synchronous invalidation on a
 * subject change, owner-only release), the subject-bound recovery outcome
 * with transport-settlement tracking, the version/subscription pair, and
 * the dot-segment-safe flow-path check.
 */

import {
  getTwoFactorFlowVersion,
  getVerifyOutcome,
  invalidateTwoFactorFlow,
  isBackupDispatchUnsettled,
  isTwoFactorLeaseOwner,
  isVerifyFlowPath,
  markVerifyDispatched,
  markVerifyIdle,
  markVerifyResponded,
  markVerifyServerVerified,
  releaseTwoFactorLease,
  subscribeTwoFactorFlow,
  tryAcquireTwoFactorLease,
  wasVerifyTokenDispatched,
} from '@/lib/two-factor-verify-flow'

const USER = { id: 'u1', isAdmin: false }
const OTHER_USER = { id: 'u2', isAdmin: false }
const SAME_ID_ADMIN = { id: 'u1', isAdmin: true }

function resetFlowState() {
  invalidateTwoFactorFlow()
  const lease = tryAcquireTwoFactorLease(USER)
  markVerifyIdle(lease)
  releaseTwoFactorLease(lease)
}

beforeEach(resetFlowState)

describe('two-factor verify lease', () => {
  it('is exclusive for the same subject: a second acquire joins (returns null)', () => {
    const first = tryAcquireTwoFactorLease(USER)
    expect(first).not.toBeNull()
    expect(tryAcquireTwoFactorLease(USER)).toBeNull()
    expect(isTwoFactorLeaseOwner(first)).toBe(true)
  })

  it('invalidates synchronously when a DIFFERENT subject acquires', () => {
    // Account switch in the same browser context: the previous user's
    // transaction must not survive into the next user's session.
    const first = tryAcquireTwoFactorLease(USER)
    const second = tryAcquireTwoFactorLease(OTHER_USER)
    expect(second).not.toBeNull()
    expect(isTwoFactorLeaseOwner(first)).toBe(false)
    expect(isTwoFactorLeaseOwner(second)).toBe(true)
    releaseTwoFactorLease(second)
  })

  it('treats the same id with a different role, and logout (null), as different subjects', () => {
    const first = tryAcquireTwoFactorLease(USER)
    const admin = tryAcquireTwoFactorLease(SAME_ID_ADMIN)
    expect(admin).not.toBeNull()
    expect(isTwoFactorLeaseOwner(first)).toBe(false)

    const anon = tryAcquireTwoFactorLease(null)
    expect(anon).not.toBeNull()
    expect(isTwoFactorLeaseOwner(admin)).toBe(false)
    releaseTwoFactorLease(anon)
  })

  it('only the owner can release; a stale id is a no-op', () => {
    const first = tryAcquireTwoFactorLease(USER)
    releaseTwoFactorLease(first)
    const second = tryAcquireTwoFactorLease(USER)
    expect(second).not.toBeNull()

    // The already-released first id must not free the second owner's lease.
    releaseTwoFactorLease(first)
    expect(isTwoFactorLeaseOwner(second)).toBe(true)
    expect(tryAcquireTwoFactorLease(USER)).toBeNull()
  })

  it('invalidateTwoFactorFlow ends ownership but keeps the recovery outcome', () => {
    const lease = tryAcquireTwoFactorLease(USER)
    markVerifyServerVerified(lease, USER)
    invalidateTwoFactorFlow()

    expect(isTwoFactorLeaseOwner(lease)).toBe(false)
    // Surviving closures must see themselves as non-owners...
    expect(tryAcquireTwoFactorLease(USER)).not.toBeNull()
    // ...but the subject can still recover via update-first.
    expect(getVerifyOutcome(USER)).toBe('serverVerified')
  })

  it('bumps the version on acquire, release and invalidate (for useSyncExternalStore)', () => {
    let notified = 0
    const unsubscribe = subscribeTwoFactorFlow(() => {
      notified++
    })
    const before = getTwoFactorFlowVersion()

    const lease = tryAcquireTwoFactorLease(USER)
    releaseTwoFactorLease(lease)
    const again = tryAcquireTwoFactorLease(USER)
    invalidateTwoFactorFlow()
    void again

    expect(getTwoFactorFlowVersion()).toBe(before + 4)
    expect(notified).toBe(4)
    unsubscribe()
  })
})

describe('verify outcome (subject-bound recovery state)', () => {
  it('tracks dispatched -> serverVerified -> idle for the owner', () => {
    const lease = tryAcquireTwoFactorLease(USER)

    markVerifyDispatched(lease, USER, 'ABCD1234', 'backup')
    expect(getVerifyOutcome(USER)).toBe('outcomeUnknown')
    expect(wasVerifyTokenDispatched(USER, 'ABCD1234')).toBe(true)
    expect(wasVerifyTokenDispatched(USER, 'WXYZ9876')).toBe(false)

    markVerifyServerVerified(lease, USER)
    expect(getVerifyOutcome(USER)).toBe('serverVerified')

    markVerifyIdle(lease)
    expect(getVerifyOutcome(USER)).toBe('idle')
    expect(wasVerifyTokenDispatched(USER, 'ABCD1234')).toBe(false)
  })

  it('flags an unresponded backup dispatch and clears it once a response arrives', () => {
    const lease = tryAcquireTwoFactorLease(USER)

    markVerifyDispatched(lease, USER, 'ABCD1234', 'backup')
    // No response yet (e.g. the fetch rejected): the request may still be
    // running server-side.
    expect(isBackupDispatchUnsettled(USER)).toBe(true)
    expect(isBackupDispatchUnsettled(OTHER_USER)).toBe(false)

    markVerifyResponded(lease)
    expect(isBackupDispatchUnsettled(USER)).toBe(false)
    expect(getVerifyOutcome(USER)).toBe('outcomeUnknown')
  })

  it('does not flag a TOTP dispatch as an unsettled backup dispatch', () => {
    const lease = tryAcquireTwoFactorLease(USER)
    markVerifyDispatched(lease, USER, '123456', 'totp')
    expect(isBackupDispatchUnsettled(USER)).toBe(false)
  })

  it('ignores writes from a non-owner lease', () => {
    const owner = tryAcquireTwoFactorLease(USER)
    markVerifyDispatched(owner, USER, '123456', 'totp')
    invalidateTwoFactorFlow()

    // The orphaned closure keeps its old id; its writes must be no-ops.
    markVerifyServerVerified(owner, USER)
    markVerifyResponded(owner)
    markVerifyIdle(owner)
    expect(getVerifyOutcome(USER)).toBe('outcomeUnknown')
  })

  it('is bound to {id, isAdmin}, not email: a different id or role reads idle', () => {
    const lease = tryAcquireTwoFactorLease(USER)
    markVerifyServerVerified(lease, USER)

    // Admin and WhitelistUser emails are not cross-table unique — the same
    // email under a different id or role must not inherit the outcome.
    expect(getVerifyOutcome(OTHER_USER)).toBe('idle')
    expect(getVerifyOutcome(SAME_ID_ADMIN)).toBe('idle')
    expect(getVerifyOutcome(USER)).toBe('serverVerified')
  })
})

describe('isVerifyFlowPath', () => {
  it('matches the flow base and its children only (no prefix bleed)', () => {
    expect(isVerifyFlowPath('/auth/verify-2fa')).toBe(true)
    expect(isVerifyFlowPath('/auth/verify-2fa/backup')).toBe(true)
    expect(isVerifyFlowPath('/auth/verify-2fa?callbackUrl=%2Fgroups%2Fx')).toBe(
      true,
    )
    expect(isVerifyFlowPath('/auth/verify-2fa#frag')).toBe(true)
    expect(isVerifyFlowPath('/auth/verify-2fa-evil')).toBe(false)
    expect(isVerifyFlowPath('/groups/x')).toBe(false)
    expect(isVerifyFlowPath('/')).toBe(false)
  })

  it('normalizes dot segments, including percent-encoded forms', () => {
    // WHATWG URL parsing collapses these back into the flow — a plain
    // string check would misclassify them as outside it.
    expect(isVerifyFlowPath('/x/../auth/verify-2fa')).toBe(true)
    expect(isVerifyFlowPath('/x/%2e%2e/auth/verify-2fa')).toBe(true)
    expect(isVerifyFlowPath('/x/.%2e/auth/verify-2fa')).toBe(true)
    expect(isVerifyFlowPath('/x/%2e./auth/verify-2fa')).toBe(true)
    expect(isVerifyFlowPath('/auth/./verify-2fa')).toBe(true)
    expect(isVerifyFlowPath('/auth/verify-2fa/../verify-2fa/backup')).toBe(true)
    // And the inverse: dot segments escaping OUT of the flow.
    expect(isVerifyFlowPath('/auth/verify-2fa/../../groups/x')).toBe(false)
  })
})
