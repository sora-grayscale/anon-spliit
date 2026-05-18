'use client'

import { useEncryption } from '@/components/encryption-provider'
import { decryptExpenses } from '@/lib/encrypt-helpers'
import { trpc } from '@/trpc/client'
import { AppRouterOutput } from '@/trpc/routers/_app'
import { useCallback, useEffect, useRef, useState } from 'react'

const PAGE_SIZE = 200

type ListAllPage = AppRouterOutput['groups']['expenses']['listAll']
type Cursor = NonNullable<ListAllPage['nextCursor']>
export type GroupExpense = ListAllPage['expenses'][number]

export interface UseAllGroupExpensesOptions {
  /**
   * When `false`, the autoDrain useEffect does not run. Imperative
   * callers (e.g. export-button) pass `false` so render-time visits do
   * not trigger any fetch — only an explicit `fetchAll()` does.
   * @default true
   */
  enabled?: boolean
  /**
   * When `true`, every (groupId, encryptionKey) identity change kicks
   * off a full drain via `useEffect`. When `false`, the consumer must
   * call `fetchAll()` themselves.
   * @default true
   */
  autoDrain?: boolean
}

export interface UseAllGroupExpensesResult {
  /**
   * Fully drained and decrypted expenses. `undefined` until every page
   * has been fetched AND decrypted — partial state is NEVER exposed
   * (Issue #80, Issue #170).
   */
  expenses: GroupExpense[] | undefined
  /** True while a drain is in flight (fetching pages or decrypting). */
  isLoading: boolean
  /** True while a page fetch is awaiting the network. */
  isFetchingNextPage: boolean
  /** Error from the tRPC fetch, if any. Separate from decryption errors. */
  queryError: Error | null
  /** Error from decryption, if any. Encrypted ciphertext is never used as fallback. */
  decryptionError: Error | null
  /**
   * Imperative drain. Returns the fully decrypted array on success;
   * throws on either fetch or decryption failure. Callers must use the
   * return value (NOT the hook `expenses` state) to avoid reading stale
   * React state inside the same closure.
   */
  fetchAll: () => Promise<GroupExpense[]>
}

/**
 * Drains `listAll` via cursor pagination, decrypting each page sequentially,
 * and exposes the fully decrypted set (or imperative `fetchAll`) to the
 * consumer.
 *
 * Issue #170: this replaces the previous "fetch up to 10K at once" path so
 * balance computation and export can scale to groups beyond the legacy cap
 * without freezing the main thread.
 *
 * Safety invariants:
 * - Partial decrypted state is never exposed (`expenses` is `undefined` until
 *   the drain finishes).
 * - Decryption failure NEVER returns encrypted ciphertext (Issue #80).
 * - State updates are gated by `isMountedRef` and an epoch counter so that
 *   stale fetches (e.g. after a `groupId` change) cannot overwrite fresh
 *   state.
 */
export function useAllGroupExpenses(
  groupId: string,
  options: UseAllGroupExpensesOptions = {},
): UseAllGroupExpensesResult {
  const { enabled = true, autoDrain = true } = options
  const { encryptionKey, isLoading: isKeyLoading, hasKey } = useEncryption()
  const utils = trpc.useUtils()

  const [expenses, setExpenses] = useState<GroupExpense[] | undefined>(
    undefined,
  )
  const [isWorking, setIsWorking] = useState(false)
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false)
  const [queryError, setQueryError] = useState<Error | null>(null)
  const [decryptionError, setDecryptionError] = useState<Error | null>(null)

  const isMountedRef = useRef(true)
  const epochRef = useRef(0)
  const resetKeyRef = useRef<string>('')

  // String-typed identity for the (groupId, encryptionKey) tuple. We avoid
  // putting `Uint8Array` directly in deps because key references can change
  // when `useEncryption` re-derives them. A short byte prefix is enough to
  // detect identity change in practice.
  const keyIdentity = encryptionKey
    ? `key:${encryptionKey.length}:${Array.from(encryptionKey.slice(0, 8)).join(
        ',',
      )}`
    : hasKey
      ? 'pending'
      : 'no-key'
  const resetKey = `${groupId}::${keyIdentity}`

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const decryptPage = useCallback(
    async (rawPage: GroupExpense[]): Promise<GroupExpense[]> => {
      if (isKeyLoading) {
        throw new Error('Encryption key is still loading')
      }
      if (!hasKey) return rawPage
      if (!encryptionKey) {
        throw new Error('Encryption key is required but missing')
      }
      return await decryptExpenses(rawPage, encryptionKey)
    },
    [encryptionKey, hasKey, isKeyLoading],
  )

  const fetchAll = useCallback(async (): Promise<GroupExpense[]> => {
    const myEpoch = ++epochRef.current
    const isCurrent = () => isMountedRef.current && myEpoch === epochRef.current

    if (isKeyLoading) {
      const err = new Error('Encryption key is still loading')
      if (isCurrent()) setQueryError(err)
      throw err
    }

    if (isCurrent()) {
      setIsWorking(true)
      setQueryError(null)
      setDecryptionError(null)
    }

    const accumulated: GroupExpense[] = []
    let cursor: Cursor | undefined = undefined

    try {
      while (true) {
        if (isCurrent()) setIsFetchingNextPage(true)
        let page: ListAllPage
        try {
          // staleTime: 0 forces a network fetch on every page. The default
          // query-client staleTime (30s) would otherwise let an invalidate()
          // be raced by a cached-response read, or let a quick re-visit serve
          // stale balances/export after a cross-device update.
          page = await utils.groups.expenses.listAll.fetch(
            {
              groupId,
              limit: PAGE_SIZE,
              cursor,
            },
            { staleTime: 0 },
          )
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          if (isCurrent()) setQueryError(error)
          throw error
        } finally {
          if (isCurrent()) setIsFetchingNextPage(false)
        }

        let decryptedPage: GroupExpense[]
        try {
          decryptedPage = await decryptPage(page.expenses)
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          if (isCurrent()) setDecryptionError(error)
          // CRITICAL (Issue #80): do NOT push encrypted ciphertext into
          // `accumulated`. Re-throw so the imperative caller (e.g. export)
          // also fails closed and never receives encrypted data.
          throw error
        }

        accumulated.push(...decryptedPage)

        if (!page.nextCursor) break
        cursor = page.nextCursor
      }

      if (isCurrent()) setExpenses(accumulated)
      return accumulated
    } finally {
      if (isCurrent()) setIsWorking(false)
    }
  }, [decryptPage, groupId, isKeyLoading, utils])

  // autoDrain path: kick off a full drain whenever the (groupId, key) identity
  // changes. Stale drains are abandoned via the epoch check inside fetchAll.
  useEffect(() => {
    if (!enabled || !autoDrain) return
    if (isKeyLoading) return

    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey
      setExpenses(undefined)
      setQueryError(null)
      setDecryptionError(null)
    }

    void fetchAll().catch(() => {
      // queryError / decryptionError are already populated inside fetchAll.
    })
  }, [enabled, autoDrain, isKeyLoading, resetKey, fetchAll])

  // Imperative path reset: clear stale state on identity change but do NOT
  // auto-trigger a fetch. The caller decides when to drain.
  useEffect(() => {
    if (autoDrain) return
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey
      setExpenses(undefined)
      setQueryError(null)
      setDecryptionError(null)
    }
  }, [autoDrain, resetKey])

  // Render-time identity guard. Both reset useEffects above run AFTER paint,
  // so without this check `rerender({ groupId: 'g2' })` would briefly expose
  // group g1's decrypted balances on g2's screen — unacceptable for an E2EE
  // fork (Codex iter2 Medium #3). resetKeyRef starts as '' so the very first
  // render also matches this branch and returns the safe no-data shape.
  const identityIsCurrent = resetKeyRef.current === resetKey
  if (!identityIsCurrent) {
    return {
      expenses: undefined,
      isLoading: true,
      isFetchingNextPage: false,
      queryError: null,
      decryptionError: null,
      fetchAll,
    }
  }

  // In autoDrain mode the drain `useEffect` only schedules `fetchAll` after
  // the first paint, so without the no-data clause `isLoading` would briefly
  // be `false` while `expenses === undefined`, exposing a "zero balances /
  // empty totals" frame to consumers (Issue #170 regression guard).
  const isLoading =
    enabled && autoDrain
      ? isWorking ||
        isKeyLoading ||
        (!expenses && !queryError && !decryptionError)
      : isWorking

  return {
    expenses,
    isLoading,
    isFetchingNextPage,
    queryError,
    decryptionError,
    fetchAll,
  }
}
