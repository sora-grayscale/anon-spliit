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
  const fetchFn = jest.fn()
  const utils = {
    groups: {
      expenses: {
        listAll: { fetch: fetchFn },
      },
    },
  }
  return {
    trpc: {
      useUtils: () => utils,
    },
    __mockListAllFetch: fetchFn,
  }
})

import { useEncryption } from '@/components/encryption-provider'
import { decryptExpenses } from '@/lib/encrypt-helpers'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useAllGroupExpenses } from './useAllGroupExpenses'

const mockUseEncryption = useEncryption as jest.MockedFunction<
  typeof useEncryption
>
const mockDecryptExpenses = decryptExpenses as jest.MockedFunction<
  typeof decryptExpenses
>
const mockListAllFetch = (
  jest.requireMock('@/trpc/client') as { __mockListAllFetch: jest.Mock }
).__mockListAllFetch

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
  mockListAllFetch.mockReset()
  mockDecryptExpenses.mockReset()
  // Default: identity passthrough decrypt
  mockDecryptExpenses.mockImplementation(async (rows) => rows as never)
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
      expect(mockListAllFetch).toHaveBeenCalledWith({
        groupId: 'g1',
        limit: 200,
        cursor: undefined,
      })
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
      expect(mockListAllFetch).toHaveBeenNthCalledWith(2, {
        groupId: 'g1',
        limit: 200,
        cursor: {
          expenseDate: '2026-05-09T12:00:00.000Z',
          createdAt: '2026-05-09T11:00:00.000Z',
          id: 'a',
        },
      })
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
})
