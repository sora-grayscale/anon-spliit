jest.mock('@/components/encryption-provider', () => ({
  useEncryption: jest.fn(),
}))
jest.mock('@/lib/encrypt-helpers', () => ({
  decryptExpenses: jest.fn(),
}))
// The real `trpc.useUtils()` returns a stable reference across renders
// (memoized internally). Our mock must mirror that, otherwise the hook's
// `fetchAll` useCallback dep keeps changing and triggers infinite re-fetches.
jest.mock('@/trpc/client', () => {
  const listAllFetch = jest.fn()
  const revisionFetch = jest.fn()
  const utils = {
    groups: {
      expenses: {
        listAll: { fetch: listAllFetch },
        revision: { fetch: revisionFetch },
      },
    },
  }
  return {
    trpc: {
      useUtils: () => utils,
    },
    __mockListAllFetch: listAllFetch,
    __mockRevisionFetch: revisionFetch,
  }
})

import { useEncryption } from '@/components/encryption-provider'
import { decryptExpenses } from '@/lib/encrypt-helpers'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  __resetAggregateCacheForTest,
  invalidateAggregate,
} from './aggregateCache'
import { useAllGroupExpenses } from './useAllGroupExpenses'

const mockUseEncryption = useEncryption as jest.MockedFunction<
  typeof useEncryption
>
const mockDecryptExpenses = decryptExpenses as jest.MockedFunction<
  typeof decryptExpenses
>
const trpcMocks = jest.requireMock('@/trpc/client') as {
  __mockListAllFetch: jest.Mock
  __mockRevisionFetch: jest.Mock
}
const mockListAllFetch = trpcMocks.__mockListAllFetch
const mockRevisionFetch = trpcMocks.__mockRevisionFetch

type FakeExpense = {
  id: string
  title: string
  amount: string | number
  // Loose shape; the hook does not introspect fields beyond passing them to
  // decryptExpenses, so a minimal shape suffices for unit tests.
}

const ENCRYPTED_KEY = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
const ENCRYPTED_KEY_2 = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9])

function withKey(key: Uint8Array = ENCRYPTED_KEY) {
  mockUseEncryption.mockReturnValue({
    encryptionKey: key,
    isLoading: false,
    hasKey: true,
  } as never)
}
function withoutKey() {
  mockUseEncryption.mockReturnValue({
    encryptionKey: null,
    isLoading: false,
    hasKey: false,
  } as never)
}

function makePage(
  expenses: FakeExpense[],
  nextCursor: {
    expenseDate: string
    createdAt: string
    id: string
  } | null = null,
) {
  return { expenses, nextCursor }
}

beforeEach(() => {
  __resetAggregateCacheForTest()
  mockListAllFetch.mockReset()
  mockDecryptExpenses.mockReset()
  mockRevisionFetch.mockReset()
  // Default: identity passthrough decrypt and a stable revision so existing
  // tests do not need to know about race detection.
  mockDecryptExpenses.mockImplementation(async (rows) => rows as never)
  mockRevisionFetch.mockResolvedValue({ revision: 1 })
})

afterEach(() => {
  __resetAggregateCacheForTest()
})

describe('useAllGroupExpenses (Issue #170)', () => {
  describe('autoDrain mode (default)', () => {
    it('drains a single page and exposes decrypted expenses', async () => {
      withKey()
      const page = makePage([{ id: 'a', title: 't', amount: '100' }])
      mockListAllFetch.mockResolvedValue(page)

      const { result } = renderHook(() => useAllGroupExpenses('g1'))
      await waitFor(() => expect(result.current.isLoading).toBe(false))

      expect(result.current.expenses).toEqual([
        { id: 'a', title: 't', amount: '100' },
      ])
      expect(result.current.queryError).toBeNull()
      expect(result.current.decryptionError).toBeNull()
      expect(mockListAllFetch).toHaveBeenCalledTimes(1)
      expect(mockListAllFetch).toHaveBeenCalledWith(
        { groupId: 'g1', limit: 200, cursor: undefined },
        { staleTime: 0 },
      )
    })

    it('drains multiple pages sequentially via cursor loop', async () => {
      withKey()
      mockListAllFetch
        .mockResolvedValueOnce(
          makePage([{ id: 'a', title: 't', amount: '1' }], {
            expenseDate: '2026-05-09T12:00:00.000Z',
            createdAt: '2026-05-09T11:00:00.000Z',
            id: 'a',
          }),
        )
        .mockResolvedValueOnce(
          makePage([{ id: 'b', title: 't', amount: '2' }], {
            expenseDate: '2026-05-08T12:00:00.000Z',
            createdAt: '2026-05-08T11:00:00.000Z',
            id: 'b',
          }),
        )
        .mockResolvedValueOnce(
          makePage([{ id: 'c', title: 't', amount: '3' }], null),
        )

      const { result } = renderHook(() => useAllGroupExpenses('g1'))
      await waitFor(() => expect(result.current.isLoading).toBe(false))

      expect(
        result.current.expenses?.map((e) => (e as FakeExpense).id),
      ).toEqual(['a', 'b', 'c'])
      expect(mockListAllFetch).toHaveBeenCalledTimes(3)
      // Second page should re-use the first page's nextCursor verbatim
      // (ISO string wire contract).
      expect(mockListAllFetch).toHaveBeenNthCalledWith(
        2,
        {
          groupId: 'g1',
          limit: 200,
          cursor: {
            expenseDate: '2026-05-09T12:00:00.000Z',
            createdAt: '2026-05-09T11:00:00.000Z',
            id: 'a',
          },
        },
        { staleTime: 0 },
      )
    })

    it('does NOT expose partial decrypted state mid-drain', async () => {
      withKey()
      let resolveSecond: (v: unknown) => void = () => {}
      mockListAllFetch
        .mockResolvedValueOnce(
          makePage([{ id: 'a', title: 't', amount: '1' }], {
            expenseDate: '2026-05-09T12:00:00.000Z',
            createdAt: '2026-05-09T11:00:00.000Z',
            id: 'a',
          }),
        )
        .mockReturnValueOnce(
          new Promise((res) => {
            resolveSecond = res
          }),
        )

      const { result } = renderHook(() => useAllGroupExpenses('g1'))
      // Wait until the second fetch is in flight.
      await waitFor(() => expect(mockListAllFetch).toHaveBeenCalledTimes(2))
      // expenses must still be undefined mid-drain — partial data must NEVER
      // be exposed to consumers (balances/export).
      expect(result.current.expenses).toBeUndefined()
      expect(result.current.isLoading).toBe(true)

      await act(async () => {
        resolveSecond(makePage([{ id: 'b', title: 't', amount: '2' }], null))
      })
      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(result.current.expenses).toHaveLength(2)
    })

    it('separates queryError from decryptionError on fetch failure', async () => {
      withKey()
      const err = new Error('network down')
      mockListAllFetch.mockRejectedValue(err)

      const { result } = renderHook(() => useAllGroupExpenses('g1'))
      await waitFor(() => expect(result.current.isLoading).toBe(false))

      expect(result.current.queryError).toBe(err)
      expect(result.current.decryptionError).toBeNull()
      expect(result.current.expenses).toBeUndefined()
    })

    it('separates decryptionError from queryError + never returns encrypted raw (Issue #80)', async () => {
      withKey()
      mockListAllFetch.mockResolvedValue(
        makePage([{ id: 'a', title: 'cipher:xx', amount: 'cipher:1' }]),
      )
      const decErr = new Error('decrypt fail')
      mockDecryptExpenses.mockRejectedValue(decErr)

      const { result } = renderHook(() => useAllGroupExpenses('g1'))
      await waitFor(() => expect(result.current.isLoading).toBe(false))

      expect(result.current.decryptionError).toBe(decErr)
      expect(result.current.queryError).toBeNull()
      // CRITICAL: encrypted ciphertext must NEVER leak into `expenses`.
      expect(result.current.expenses).toBeUndefined()
    })

    it('passes through expenses unchanged when no encryption key (unencrypted group)', async () => {
      withoutKey()
      mockListAllFetch.mockResolvedValue(
        makePage([{ id: 'a', title: 'plain', amount: 100 }]),
      )
      const { result } = renderHook(() => useAllGroupExpenses('g1'))
      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(result.current.expenses).toEqual([
        { id: 'a', title: 'plain', amount: 100 },
      ])
      // decryptExpenses should NOT be called when hasKey=false.
      expect(mockDecryptExpenses).not.toHaveBeenCalled()
    })

    it('resets state when groupId changes', async () => {
      withKey()
      mockListAllFetch.mockResolvedValue(
        makePage([{ id: 'a', title: 't', amount: '1' }]),
      )
      const { result, rerender } = renderHook(
        ({ groupId }) => useAllGroupExpenses(groupId),
        { initialProps: { groupId: 'g1' } },
      )
      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(result.current.expenses).toHaveLength(1)

      // Switch to a different group; expenses must be cleared and a new drain
      // should start.
      mockListAllFetch.mockResolvedValueOnce(
        makePage([
          { id: 'x', title: 't', amount: '9' },
          { id: 'y', title: 't', amount: '9' },
        ]),
      )
      rerender({ groupId: 'g2' })
      // Synchronously after the rerender, the stale expenses should be gone.
      // (The effect runs, sets expenses=undefined before the new fetch
      // resolves.) Allow a microtask for the effect to run.
      await waitFor(() => expect(result.current.expenses?.length ?? 0).toBe(2))
      expect(
        (result.current.expenses ?? []).map((e) => (e as FakeExpense).id),
      ).toEqual(['x', 'y'])
    })

    it('resets state when encryption key changes', async () => {
      withKey(ENCRYPTED_KEY)
      mockListAllFetch.mockResolvedValue(
        makePage([{ id: 'a', title: 't', amount: '1' }]),
      )
      const { result, rerender } = renderHook(() => useAllGroupExpenses('g1'))
      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(result.current.expenses).toHaveLength(1)

      // Switch the encryption key returned by useEncryption.
      withKey(ENCRYPTED_KEY_2)
      mockListAllFetch.mockResolvedValueOnce(
        makePage([
          { id: 'p', title: 't', amount: '1' },
          { id: 'q', title: 't', amount: '1' },
        ]),
      )
      rerender()
      await waitFor(() => expect(result.current.expenses?.length ?? 0).toBe(2))
    })

    it('reports isLoading=true on initial render before the drain has started (Codex iter1 Medium #1)', () => {
      withKey()
      // Never-resolving page so the drain stays in-flight indefinitely.
      mockListAllFetch.mockImplementation(() => new Promise(() => {}))
      const { result } = renderHook(() => useAllGroupExpenses('g1'))
      // BEFORE any effect runs: expenses must be undefined AND isLoading
      // must already be true so consumers do not flash a zero-state UI.
      expect(result.current.expenses).toBeUndefined()
      expect(result.current.isLoading).toBe(true)
    })

    it('does NOT expose old groups expenses for the 1 render after groupId changes (Codex iter2 Medium #3)', async () => {
      withKey()
      mockListAllFetch.mockResolvedValueOnce(
        makePage([{ id: 'old-1', title: 't', amount: '1' }], null),
      )
      const { result, rerender } = renderHook(
        ({ groupId }) => useAllGroupExpenses(groupId),
        { initialProps: { groupId: 'g1' } },
      )
      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(result.current.expenses).toEqual([
        { id: 'old-1', title: 't', amount: '1' },
      ])

      // Switch to a new group. The next render must NOT expose g1's
      // decrypted data — the reset useEffect only fires AFTER paint, so
      // a render-time guard is required.
      mockListAllFetch.mockImplementation(() => new Promise(() => {}))
      rerender({ groupId: 'g2' })
      // Synchronously after rerender — no waitFor, no act flush.
      expect(result.current.expenses).toBeUndefined()
      expect(result.current.isLoading).toBe(true)
    })

    it('does NOT expose old keys expenses for the 1 render after encryption key changes (Codex iter2 Medium #3)', async () => {
      withKey(ENCRYPTED_KEY)
      mockListAllFetch.mockResolvedValueOnce(
        makePage([{ id: 'enc-old', title: 't', amount: '1' }], null),
      )
      const { result, rerender } = renderHook(() => useAllGroupExpenses('g1'))
      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(result.current.expenses).toHaveLength(1)

      // Switch the encryption key the provider returns.
      withKey(ENCRYPTED_KEY_2)
      mockListAllFetch.mockImplementation(() => new Promise(() => {}))
      rerender()
      // Synchronously after rerender — no waitFor, no act flush.
      expect(result.current.expenses).toBeUndefined()
      expect(result.current.isLoading).toBe(true)
    })

    it('passes staleTime: 0 to every page fetch to bypass the React Query cache (Codex iter1 Medium #2)', async () => {
      withKey()
      mockListAllFetch
        .mockResolvedValueOnce(
          makePage([{ id: 'a', title: 't', amount: '1' }], {
            expenseDate: '2026-05-09T12:00:00.000Z',
            createdAt: '2026-05-09T11:00:00.000Z',
            id: 'a',
          }),
        )
        .mockResolvedValueOnce(
          makePage([{ id: 'b', title: 't', amount: '2' }], null),
        )

      const { result } = renderHook(() => useAllGroupExpenses('g1'))
      await waitFor(() => expect(result.current.isLoading).toBe(false))

      expect(mockListAllFetch).toHaveBeenCalledTimes(2)
      for (const call of mockListAllFetch.mock.calls) {
        expect(call[1]).toEqual(expect.objectContaining({ staleTime: 0 }))
      }
    })
  })

  describe('imperative path (enabled:false, autoDrain:false)', () => {
    it('does NOT trigger any fetch on mount', async () => {
      withKey()
      renderHook(() =>
        useAllGroupExpenses('g1', { enabled: false, autoDrain: false }),
      )
      // Give effects a chance to run.
      await new Promise((res) => setTimeout(res, 0))
      expect(mockListAllFetch).not.toHaveBeenCalled()
    })

    it('fetchAll returns the fully decrypted array (not state)', async () => {
      withKey()
      mockListAllFetch
        .mockResolvedValueOnce(
          makePage([{ id: 'a', title: 't', amount: '1' }], {
            expenseDate: '2026-05-09T12:00:00.000Z',
            createdAt: '2026-05-09T11:00:00.000Z',
            id: 'a',
          }),
        )
        .mockResolvedValueOnce(
          makePage([{ id: 'b', title: 't', amount: '2' }], null),
        )

      const { result } = renderHook(() =>
        useAllGroupExpenses('g1', { enabled: false, autoDrain: false }),
      )

      let returned: unknown
      await act(async () => {
        returned = await result.current.fetchAll()
      })

      expect(Array.isArray(returned)).toBe(true)
      expect((returned as FakeExpense[]).map((e) => e.id)).toEqual(['a', 'b'])
    })

    it('fetchAll throws on decryption failure without returning encrypted raw', async () => {
      withKey()
      mockListAllFetch.mockResolvedValue(
        makePage([{ id: 'a', title: 'cipher:xx', amount: 'cipher:1' }]),
      )
      mockDecryptExpenses.mockRejectedValue(new Error('decrypt fail'))

      const { result } = renderHook(() =>
        useAllGroupExpenses('g1', { enabled: false, autoDrain: false }),
      )

      let caught: unknown
      await act(async () => {
        try {
          await result.current.fetchAll()
        } catch (e) {
          caught = e
        }
      })

      expect(caught).toBeInstanceOf(Error)
      expect((caught as Error).message).toMatch(/decrypt fail/)
      expect(result.current.decryptionError?.message).toMatch(/decrypt fail/)
      // CRITICAL: encrypted ciphertext must NEVER leak into `expenses`.
      expect(result.current.expenses).toBeUndefined()
    })

    it('fetchAll throws on fetch failure and sets queryError (not decryptionError)', async () => {
      withKey()
      mockListAllFetch.mockRejectedValue(new Error('boom'))

      const { result } = renderHook(() =>
        useAllGroupExpenses('g1', { enabled: false, autoDrain: false }),
      )

      let caught: unknown
      await act(async () => {
        try {
          await result.current.fetchAll()
        } catch (e) {
          caught = e
        }
      })

      expect(caught).toBeInstanceOf(Error)
      expect((caught as Error).message).toMatch(/boom/)
      expect(result.current.queryError?.message).toMatch(/boom/)
      expect(result.current.decryptionError).toBeNull()
    })
  })

  describe('aggregate cache + race detection (Issue #225)', () => {
    it('does NOT re-drain on remount when revision is unchanged', async () => {
      withKey()
      mockListAllFetch.mockResolvedValue(
        makePage([{ id: 'a', title: 't', amount: '1' }]),
      )
      mockRevisionFetch.mockResolvedValue({ revision: 5 })

      const { result, unmount } = renderHook(() => useAllGroupExpenses('g1'))
      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(result.current.expenses).toHaveLength(1)

      const fetchCountBefore = mockListAllFetch.mock.calls.length
      const decryptCountBefore = mockDecryptExpenses.mock.calls.length

      unmount()

      // New mount with the same (groupId, key) and unchanged server revision
      // must serve the cached aggregate without a single page fetch or
      // decrypt call.
      const { result: result2 } = renderHook(() => useAllGroupExpenses('g1'))
      await waitFor(() => expect(result2.current.isLoading).toBe(false))
      expect(result2.current.expenses).toHaveLength(1)

      expect(mockListAllFetch.mock.calls.length).toBe(fetchCountBefore)
      expect(mockDecryptExpenses.mock.calls.length).toBe(decryptCountBefore)
    })

    it('re-drains on remount when revision changes', async () => {
      withKey()
      mockListAllFetch.mockResolvedValue(
        makePage([{ id: 'a', title: 't', amount: '1' }]),
      )
      mockRevisionFetch.mockResolvedValue({ revision: 5 })

      const { result, unmount } = renderHook(() => useAllGroupExpenses('g1'))
      await waitFor(() => expect(result.current.isLoading).toBe(false))

      const fetchCountBefore = mockListAllFetch.mock.calls.length
      unmount()
      mockRevisionFetch.mockResolvedValue({ revision: 6 })

      const { result: result2 } = renderHook(() => useAllGroupExpenses('g1'))
      await waitFor(() => expect(result2.current.isLoading).toBe(false))
      expect(mockListAllFetch.mock.calls.length).toBeGreaterThan(
        fetchCountBefore,
      )
    })

    it('forceFresh bypasses cache get/set but keeps race detection', async () => {
      withKey()
      mockListAllFetch.mockResolvedValue(
        makePage([{ id: 'a', title: 't', amount: '1' }]),
      )
      mockRevisionFetch.mockResolvedValue({ revision: 5 })

      // Step 1: imperative forceFresh on an empty cache — drain runs and
      // race detection (revBefore + revAfter) must still fire.
      const { result: imperative } = renderHook(() =>
        useAllGroupExpenses('g1', { enabled: false, autoDrain: false }),
      )
      await act(async () => {
        await imperative.current.fetchAll({ forceFresh: true })
      })

      const fetchAfterForceFresh = mockListAllFetch.mock.calls.length
      expect(fetchAfterForceFresh).toBeGreaterThan(0)
      // revBefore + revAfter at minimum (forceFresh skips the cache-check
      // revision fetch, but the race detector still issues two).
      expect(mockRevisionFetch.mock.calls.length).toBeGreaterThanOrEqual(2)

      // Step 2: autoDrain at the SAME revision should NOT cache-hit because
      // forceFresh must not populate L2 — confirm via a second drain.
      const { result: autoResult } = renderHook(() => useAllGroupExpenses('g1'))
      await waitFor(() => expect(autoResult.current.isLoading).toBe(false))
      expect(mockListAllFetch.mock.calls.length).toBeGreaterThan(
        fetchAfterForceFresh,
      )
    })

    it('retries on revision race and fails closed after two consecutive races', async () => {
      withKey()
      mockListAllFetch.mockResolvedValue(
        makePage([{ id: 'a', title: 't', amount: '1' }]),
      )
      // Each revision fetch returns a different number, so every
      // revBefore !== revAfter pair forces a retry and ultimately fails
      // closed after two attempts.
      let call = 0
      mockRevisionFetch.mockImplementation(async () => {
        call++
        return { revision: call }
      })

      const { result } = renderHook(() => useAllGroupExpenses('g1'))
      await waitFor(() => expect(result.current.queryError).not.toBeNull())
      expect(result.current.queryError?.message).toMatch(/Concurrent mutation/)
      // Stale snapshot must NOT be exposed.
      expect(result.current.expenses).toBeUndefined()
      // isLoading flips to false so consumers render their error state.
      expect(result.current.isLoading).toBe(false)
    })

    it('fails closed when revision fetch throws (does NOT serve cached aggregate)', async () => {
      withKey()
      mockListAllFetch.mockResolvedValue(
        makePage([{ id: 'a', title: 't', amount: '1' }]),
      )
      mockRevisionFetch.mockResolvedValue({ revision: 5 })

      // Prime the cache.
      const { result, unmount } = renderHook(() => useAllGroupExpenses('g1'))
      await waitFor(() => expect(result.current.isLoading).toBe(false))
      unmount()

      mockRevisionFetch.mockReset()
      mockRevisionFetch.mockRejectedValue(new Error('revision boom'))

      const { result: result2 } = renderHook(() => useAllGroupExpenses('g1'))
      await waitFor(() =>
        expect(result2.current.queryError?.message).toMatch(/revision boom/),
      )
      expect(result2.current.expenses).toBeUndefined()
    })

    it('re-drains after invalidateAggregate', async () => {
      withKey()
      mockListAllFetch.mockResolvedValue(
        makePage([{ id: 'a', title: 't', amount: '1' }]),
      )
      mockRevisionFetch.mockResolvedValue({ revision: 5 })

      const { result, unmount } = renderHook(() => useAllGroupExpenses('g1'))
      await waitFor(() => expect(result.current.isLoading).toBe(false))
      unmount()

      invalidateAggregate('g1')

      const fetchCountBefore = mockListAllFetch.mock.calls.length
      const { result: result2 } = renderHook(() => useAllGroupExpenses('g1'))
      await waitFor(() => expect(result2.current.isLoading).toBe(false))
      expect(mockListAllFetch.mock.calls.length).toBeGreaterThan(
        fetchCountBefore,
      )
    })
  })
})
