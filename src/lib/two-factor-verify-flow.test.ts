/**
 * @jest-environment jsdom
 */

/**
 * Unit tests for the 2FA verify-flow store: exclusive lease semantics
 * (no steal, owner-only release, flow-wide invalidation) and the
 * subject-bound recovery outcome.
 */

import {
  getVerifyOutcome,
  invalidateTwoFactorFlow,
  isTwoFactorLeaseOwner,
  isVerifyFlowPath,
  markVerifyDispatched,
  markVerifyIdle,
  markVerifyServerVerified,
  releaseTwoFactorLease,
  tryAcquireTwoFactorLease,
  wasVerifyTokenDispatched,
} from '@/lib/two-factor-verify-flow'

const USER = { id: 'u1', isAdmin: false }

function resetFlowState() {
  invalidateTwoFactorFlow()
  const lease = tryAcquireTwoFactorLease()
  markVerifyIdle(lease)
  releaseTwoFactorLease(lease)
}

beforeEach(resetFlowState)

describe('two-factor verify lease', () => {
  it('is exclusive: a second acquire fails while one is active (no steal)', () => {
    const first = tryAcquireTwoFactorLease()
    expect(first).not.toBeNull()
    expect(tryAcquireTwoFactorLease()).toBeNull()
    expect(isTwoFactorLeaseOwner(first)).toBe(true)
  })

  it('only the owner can release; a stale id is a no-op', () => {
    const first = tryAcquireTwoFactorLease()
    releaseTwoFactorLease(first)
    const second = tryAcquireTwoFactorLease()
    expect(second).not.toBeNull()

    // The already-released first id must not free the second owner's lease.
    releaseTwoFactorLease(first)
    expect(isTwoFactorLeaseOwner(second)).toBe(true)
    expect(tryAcquireTwoFactorLease()).toBeNull()
  })

  it('invalidateTwoFactorFlow ends ownership but keeps the recovery outcome', () => {
    const lease = tryAcquireTwoFactorLease()
    markVerifyServerVerified(lease, USER)
    invalidateTwoFactorFlow()

    expect(isTwoFactorLeaseOwner(lease)).toBe(false)
    // Surviving closures must see themselves as non-owners...
    expect(tryAcquireTwoFactorLease()).not.toBeNull()
    // ...but the subject can still recover via update-first.
    expect(getVerifyOutcome(USER)).toBe('serverVerified')
  })
})

describe('verify outcome (subject-bound recovery state)', () => {
  it('tracks dispatched -> serverVerified -> idle for the owner', () => {
    const lease = tryAcquireTwoFactorLease()

    markVerifyDispatched(lease, USER, 'ABCD1234')
    expect(getVerifyOutcome(USER)).toBe('outcomeUnknown')
    expect(wasVerifyTokenDispatched(USER, 'ABCD1234')).toBe(true)
    expect(wasVerifyTokenDispatched(USER, 'WXYZ9876')).toBe(false)

    markVerifyServerVerified(lease, USER)
    expect(getVerifyOutcome(USER)).toBe('serverVerified')

    markVerifyIdle(lease)
    expect(getVerifyOutcome(USER)).toBe('idle')
    expect(wasVerifyTokenDispatched(USER, 'ABCD1234')).toBe(false)
  })

  it('ignores writes from a non-owner lease', () => {
    const owner = tryAcquireTwoFactorLease()
    markVerifyDispatched(owner, USER, '123456')
    invalidateTwoFactorFlow()

    // The orphaned closure keeps its old id; its writes must be no-ops.
    markVerifyServerVerified(owner, USER)
    markVerifyIdle(owner)
    expect(getVerifyOutcome(USER)).toBe('outcomeUnknown')
  })

  it('is bound to {id, isAdmin}, not email: a different id or role reads idle', () => {
    const lease = tryAcquireTwoFactorLease()
    markVerifyServerVerified(lease, USER)

    // Admin and WhitelistUser emails are not cross-table unique — the same
    // email under a different id or role must not inherit the outcome.
    expect(getVerifyOutcome({ id: 'u2', isAdmin: false })).toBe('idle')
    expect(getVerifyOutcome({ id: 'u1', isAdmin: true })).toBe('idle')
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
})
