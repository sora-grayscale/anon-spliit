/**
 * @jest-environment jsdom
 */

import {
  __resetAggregateCacheForTest,
  computeFingerprint,
  getAggregate,
  invalidateAggregate,
  setAggregate,
  type GroupExpense,
} from './aggregateCache'

function fakeExpenses(n: number): GroupExpense[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
  })) as GroupExpense[]
}

beforeEach(() => {
  __resetAggregateCacheForTest()
})

afterEach(() => {
  __resetAggregateCacheForTest()
})

describe('aggregateCache (Issue #225)', () => {
  describe('get / set basics', () => {
    it('returns the stored aggregate on a fresh hit', () => {
      const xs = fakeExpenses(3)
      setAggregate('g1', 'fp1', 1, xs)
      expect(getAggregate('g1', 'fp1', 1)).toBe(xs)
    })

    it('returns undefined on miss', () => {
      expect(getAggregate('g1', 'fp1', 1)).toBeUndefined()
    })
  })

  describe('TTL (hit validity)', () => {
    it('treats a 60s+ old entry as a miss and deletes it', () => {
      jest.useFakeTimers()
      try {
        jest.setSystemTime(new Date('2026-05-18T00:00:00.000Z'))
        setAggregate('g1', 'fp1', 1, fakeExpenses(2))
        jest.setSystemTime(new Date('2026-05-18T00:01:01.000Z'))
        expect(getAggregate('g1', 'fp1', 1)).toBeUndefined()
        // After eviction-on-access, a fresh set should work normally.
        setAggregate('g1', 'fp1', 2, fakeExpenses(3))
        expect(getAggregate('g1', 'fp1', 2)).toHaveLength(3)
      } finally {
        jest.useRealTimers()
      }
    })
  })

  describe('revision mismatch', () => {
    it('returns undefined and deletes the entry on revision mismatch', () => {
      setAggregate('g1', 'fp1', 1, fakeExpenses(2))
      expect(getAggregate('g1', 'fp1', 2)).toBeUndefined()
      // The entry was deleted, so re-querying the original revision misses too.
      expect(getAggregate('g1', 'fp1', 1)).toBeUndefined()
    })
  })

  describe('invalidateAggregate', () => {
    it('removes all entries for the target groupId, leaves other groups alone', () => {
      setAggregate('g1', 'fpA', 1, fakeExpenses(1))
      setAggregate('g1', 'fpB', 1, fakeExpenses(1))
      setAggregate('g2', 'fpA', 1, fakeExpenses(1))
      invalidateAggregate('g1')
      expect(getAggregate('g1', 'fpA', 1)).toBeUndefined()
      expect(getAggregate('g1', 'fpB', 1)).toBeUndefined()
      expect(getAggregate('g2', 'fpA', 1)).toHaveLength(1)
    })
  })

  describe('LRU eviction (MAX_ENTRIES=16)', () => {
    it('evicts least-recently-used, not just oldest insertion', () => {
      for (let i = 0; i < 16; i++) {
        setAggregate(`g${i}`, 'fp', 1, fakeExpenses(1))
      }
      // Recency-promote g0.
      expect(getAggregate('g0', 'fp', 1)).toBeDefined()
      // The next insert triggers eviction — the victim must be g1 (oldest
      // after g0 was promoted), NOT g0.
      setAggregate('g16', 'fp', 1, fakeExpenses(1))
      expect(getAggregate('g0', 'fp', 1)).toBeDefined()
      expect(getAggregate('g1', 'fp', 1)).toBeUndefined()
      expect(getAggregate('g16', 'fp', 1)).toBeDefined()
    })
  })

  describe('computeFingerprint', () => {
    it('returns "no-key" when hasKey is false', async () => {
      expect(await computeFingerprint(null, false)).toBe('no-key')
      expect(await computeFingerprint(new Uint8Array([1, 2]), false)).toBe(
        'no-key',
      )
    })

    it('returns a stable hex digest for the same key', async () => {
      const fp1 = await computeFingerprint(new Uint8Array([1, 2, 3, 4]), true)
      const fp2 = await computeFingerprint(new Uint8Array([1, 2, 3, 4]), true)
      expect(fp1).toBe(fp2)
      expect(fp1).toMatch(/^[0-9a-f]{32}$/)
    })

    it('returns different digests for different keys', async () => {
      const fp1 = await computeFingerprint(new Uint8Array([1]), true)
      const fp2 = await computeFingerprint(new Uint8Array([2]), true)
      expect(fp1).not.toBe(fp2)
    })

    it('"no-key" cannot collide with an encrypted partition', async () => {
      const fp = await computeFingerprint(new Uint8Array([0]), true)
      expect(fp).toHaveLength(32)
      expect(fp).not.toBe('no-key')
    })
  })

  // jsdom does not ship BroadcastChannel by default; skip the cross-tab
  // integration test when the global is missing. The "works without
  // BroadcastChannel" test below still runs and proves the fail-safe path.
  const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined'
  const itIfBC = hasBroadcastChannel ? it : it.skip

  describe('BroadcastChannel cross-tab', () => {
    itIfBC(
      'posts groupId on invalidateAggregate and other tabs receive it',
      async () => {
        setAggregate('g1', 'fp', 1, fakeExpenses(1))
        const remote = new BroadcastChannel('anon-spliit:aggregate-invalidate')
        const recv = jest.fn()
        remote.onmessage = recv
        try {
          invalidateAggregate('g1')
          await new Promise((resolve) => setTimeout(resolve, 0))
          expect(recv).toHaveBeenCalledWith(
            expect.objectContaining({ data: { groupId: 'g1' } }),
          )
        } finally {
          remote.close()
        }
      },
    )

    it('works in environments without BroadcastChannel (no throw)', () => {
      const original = (globalThis as { BroadcastChannel?: unknown })
        .BroadcastChannel
      ;(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
        undefined
      try {
        __resetAggregateCacheForTest()
        setAggregate('g1', 'fp', 1, fakeExpenses(1))
        expect(getAggregate('g1', 'fp', 1)).toHaveLength(1)
        invalidateAggregate('g1')
        expect(getAggregate('g1', 'fp', 1)).toBeUndefined()
      } finally {
        ;(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
          original
      }
    })
  })

  describe('__resetAggregateCacheForTest', () => {
    it('clears all cached entries', () => {
      setAggregate('g1', 'fp', 1, fakeExpenses(1))
      setAggregate('g2', 'fp', 1, fakeExpenses(1))
      __resetAggregateCacheForTest()
      expect(getAggregate('g1', 'fp', 1)).toBeUndefined()
      expect(getAggregate('g2', 'fp', 1)).toBeUndefined()
    })
  })
})
