import {
  clearPendingFragment,
  restorePendingFragment,
  setPendingFragment,
  takePendingFragment,
} from './pending-fragment'

const ALICE = { id: 'alice', isAdmin: false }
const BOB = { id: 'bob', isAdmin: false }
const ALICE_ADMIN = { id: 'alice', isAdmin: true }

// The store is a single module-level slot. Every test uses its own unique
// path and seeds its own value, so cases never depend on execution order:
// a leftover entry from another test can only mismatch (returning null) or
// be overwritten by the test's own write.
describe('pending-fragment', () => {
  it('returns null when nothing is pending for the path', () => {
    clearPendingFragment()
    expect(takePendingFragment('/groups/none', ALICE)).toBeNull()
  })

  it('round-trips a fragment for the path and subject it was captured on, one-shot', () => {
    setPendingFragment('/groups/rt', 'KEYrt', ALICE)
    expect(takePendingFragment('/groups/rt', ALICE)).toBe('KEYrt')
    expect(takePendingFragment('/groups/rt', ALICE)).toBeNull()
  })

  it('does not hand a fragment to a different path and keeps it for its own', () => {
    setPendingFragment('/groups/mine', 'KEYmine', ALICE)
    expect(takePendingFragment('/groups/other', ALICE)).toBeNull()
    expect(takePendingFragment('/groups/mine', ALICE)).toBe('KEYmine')
  })

  it('DESTROYS the entry when a different subject takes: no cross-account re-attach', () => {
    // A's key parked, then B completes 2FA on the same path in the same
    // browser context: B must not receive A's key, and A's key must not
    // stay parked either (fail-closed).
    setPendingFragment('/groups/xacct', 'KEYalice', ALICE)
    expect(takePendingFragment('/groups/xacct', BOB)).toBeNull()
    expect(takePendingFragment('/groups/xacct', ALICE)).toBeNull()
  })

  it('treats the same id with a different role as a different subject', () => {
    // Admin and WhitelistUser ids/emails are separate namespaces.
    setPendingFragment('/groups/role', 'KEYrole', ALICE)
    expect(takePendingFragment('/groups/role', ALICE_ADMIN)).toBeNull()
    expect(takePendingFragment('/groups/role', ALICE)).toBeNull()
  })

  it('clearPendingFragment destroys the slot', () => {
    setPendingFragment('/groups/clear', 'KEYclear', ALICE)
    clearPendingFragment()
    expect(takePendingFragment('/groups/clear', ALICE)).toBeNull()
  })

  it('ignores empty writes so a late empty capture cannot clobber a key', () => {
    setPendingFragment('/groups/keep', 'KEYkeep', ALICE)
    setPendingFragment('/groups/keep', '', ALICE)
    expect(takePendingFragment('/groups/keep', ALICE)).toBe('KEYkeep')
  })

  it('lets a newer capture replace an older one (latest interception wins)', () => {
    setPendingFragment('/groups/older', 'KEYolder', ALICE)
    setPendingFragment('/groups/newer', 'KEYnewer', ALICE)
    expect(takePendingFragment('/groups/older', ALICE)).toBeNull()
    expect(takePendingFragment('/groups/newer', ALICE)).toBe('KEYnewer')
  })

  describe('restorePendingFragment', () => {
    it('re-attaches a pending fragment to the callback URL', () => {
      setPendingFragment('/groups/attach', 'KEYattach', ALICE)
      expect(restorePendingFragment('/groups/attach', ALICE)).toBe(
        '/groups/attach#KEYattach',
      )
    })

    it('consumes the fragment (one-shot through restore as well)', () => {
      setPendingFragment('/groups/once', 'KEYonce', ALICE)
      restorePendingFragment('/groups/once', ALICE)
      expect(restorePendingFragment('/groups/once', ALICE)).toBe('/groups/once')
    })

    it("does not re-attach another subject's fragment and destroys it", () => {
      setPendingFragment('/groups/xrest', 'KEYxrest', ALICE)
      expect(restorePendingFragment('/groups/xrest', BOB)).toBe('/groups/xrest')
      expect(takePendingFragment('/groups/xrest', ALICE)).toBeNull()
    })

    it('replaces a hash already present on the callback URL', () => {
      setPendingFragment('/groups/swap', 'KEYswap', ALICE)
      expect(restorePendingFragment('/groups/swap#stale', ALICE)).toBe(
        '/groups/swap#KEYswap',
      )
    })

    it('returns the URL untouched, existing hash included, when nothing is pending', () => {
      clearPendingFragment()
      expect(restorePendingFragment('/groups/plain#kept', ALICE)).toBe(
        '/groups/plain#kept',
      )
    })

    it('does not match a callback URL carrying a query the capture did not have', () => {
      setPendingFragment('/groups/q', 'KEYq', ALICE)
      expect(restorePendingFragment('/groups/q?tab=stats', ALICE)).toBe(
        '/groups/q?tab=stats',
      )
      // The mismatched restore must not have consumed the entry.
      expect(takePendingFragment('/groups/q', ALICE)).toBe('KEYq')
    })
  })
})
