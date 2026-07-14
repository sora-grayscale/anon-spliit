import {
  restorePendingFragment,
  setPendingFragment,
  takePendingFragment,
} from './pending-fragment'

// The store is a single module-level slot. Every test uses its own unique
// path and seeds its own value, so cases never depend on execution order:
// a leftover entry from another test can only mismatch (returning null) or
// be overwritten by the test's own write.
describe('pending-fragment', () => {
  it('returns null when nothing is pending for the path', () => {
    expect(takePendingFragment('/groups/none')).toBeNull()
  })

  it('round-trips a fragment for the path it was captured on, one-shot', () => {
    setPendingFragment('/groups/rt', 'KEYrt')
    expect(takePendingFragment('/groups/rt')).toBe('KEYrt')
    expect(takePendingFragment('/groups/rt')).toBeNull()
  })

  it('does not hand a fragment to a different path and keeps it for its own', () => {
    setPendingFragment('/groups/mine', 'KEYmine')
    expect(takePendingFragment('/groups/other')).toBeNull()
    expect(takePendingFragment('/groups/mine')).toBe('KEYmine')
  })

  it('ignores empty writes so a late empty capture cannot clobber a key', () => {
    setPendingFragment('/groups/keep', 'KEYkeep')
    setPendingFragment('/groups/keep', '')
    expect(takePendingFragment('/groups/keep')).toBe('KEYkeep')
  })

  it('lets a newer capture replace an older one (latest interception wins)', () => {
    setPendingFragment('/groups/older', 'KEYolder')
    setPendingFragment('/groups/newer', 'KEYnewer')
    expect(takePendingFragment('/groups/older')).toBeNull()
    expect(takePendingFragment('/groups/newer')).toBe('KEYnewer')
  })

  describe('restorePendingFragment', () => {
    it('re-attaches a pending fragment to the callback URL', () => {
      setPendingFragment('/groups/attach', 'KEYattach')
      expect(restorePendingFragment('/groups/attach')).toBe(
        '/groups/attach#KEYattach',
      )
    })

    it('consumes the fragment (one-shot through restore as well)', () => {
      setPendingFragment('/groups/once', 'KEYonce')
      restorePendingFragment('/groups/once')
      expect(restorePendingFragment('/groups/once')).toBe('/groups/once')
    })

    it('replaces a hash already present on the callback URL', () => {
      setPendingFragment('/groups/swap', 'KEYswap')
      expect(restorePendingFragment('/groups/swap#stale')).toBe(
        '/groups/swap#KEYswap',
      )
    })

    it('returns the URL untouched, existing hash included, when nothing is pending', () => {
      expect(restorePendingFragment('/groups/plain#kept')).toBe(
        '/groups/plain#kept',
      )
    })

    it('does not match a callback URL carrying a query the capture did not have', () => {
      setPendingFragment('/groups/q', 'KEYq')
      expect(restorePendingFragment('/groups/q?tab=stats')).toBe(
        '/groups/q?tab=stats',
      )
      // The mismatched restore must not have consumed the entry.
      expect(takePendingFragment('/groups/q')).toBe('KEYq')
    })
  })
})
