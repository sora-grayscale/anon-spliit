import type { AppRouterOutput } from '@/trpc/routers/_app'

type ListAllPage = AppRouterOutput['groups']['expenses']['listAll']
export type GroupExpense = ListAllPage['expenses'][number]

type Entry = {
  expenses: GroupExpense[]
  storedAt: number
  revision: number
}

const TTL_MS = 60 * 1000
const MAX_ENTRIES = 16
const CHANNEL_NAME = 'anon-spliit:aggregate-invalidate'

const cache = new Map<string, Entry>()
let channel: BroadcastChannel | null = null

function makeKey(groupId: string, fingerprint: string): string {
  return `${groupId}::${fingerprint}`
}

function pruneExpired(): void {
  const now = Date.now()
  const keysToDelete: string[] = []
  cache.forEach((entry, k) => {
    if (now - entry.storedAt > TTL_MS) keysToDelete.push(k)
  })
  keysToDelete.forEach((k) => cache.delete(k))
}

function invalidateInternal(groupId: string): void {
  const prefix = `${groupId}::`
  const keysToDelete: string[] = []
  cache.forEach((_, k) => {
    if (k.startsWith(prefix)) keysToDelete.push(k)
  })
  keysToDelete.forEach((k) => cache.delete(k))
}

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null
  if (typeof BroadcastChannel === 'undefined') return null
  if (channel) return channel
  channel = new BroadcastChannel(CHANNEL_NAME)
  channel.onmessage = (event: MessageEvent) => {
    const data = event.data as { groupId?: unknown }
    if (data && typeof data.groupId === 'string') {
      invalidateInternal(data.groupId)
    }
  }
  return channel
}

/**
 * Stable identity for an encryption key (or `'no-key'` for unencrypted
 * groups). SHA-256 truncated to 16 bytes (32 hex chars) — 128-bit collision
 * space is far more than enough given O(1) live groups per session, and
 * the raw key never enters the cache partition map.
 */
export async function computeFingerprint(
  key: Uint8Array | null,
  hasKey: boolean,
): Promise<string> {
  if (!hasKey || !key) return 'no-key'
  // Wrap in a fresh Uint8Array so the input matches BufferSource regardless
  // of how the caller produced it (mirrors `crypto.subtle.importKey` usage
  // in `src/lib/crypto.ts`).
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(key))
  return Array.from(new Uint8Array(digest).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Returns the cached decrypted aggregate iff it is within TTL AND its
 * stored revision matches `currentRevision`. Expired or revision-mismatched
 * entries are deleted on access.
 *
 * On a hit the entry is bumped to the end of the Map so the LRU eviction
 * in {@link setAggregate} evicts the *actually* least-recently-used entry
 * rather than just the oldest insertion (FIFO).
 *
 * TTL is hit validity only — idle entries can remain in memory up to
 * `MAX_ENTRIES` until a subsequent `setAggregate`, `invalidateAggregate`,
 * or `__resetAggregateCacheForTest` call reaps them.
 */
export function getAggregate(
  groupId: string,
  fingerprint: string,
  currentRevision: number,
): GroupExpense[] | undefined {
  pruneExpired()
  const key = makeKey(groupId, fingerprint)
  const entry = cache.get(key)
  if (!entry) return undefined
  if (entry.revision !== currentRevision) {
    cache.delete(key)
    return undefined
  }
  // LRU recency: move to end of Map.
  cache.delete(key)
  cache.set(key, entry)
  return entry.expenses
}

export function setAggregate(
  groupId: string,
  fingerprint: string,
  revision: number,
  expenses: GroupExpense[],
): void {
  pruneExpired()
  const key = makeKey(groupId, fingerprint)
  cache.delete(key)
  cache.set(key, { expenses, storedAt: Date.now(), revision })
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  // Lazy-initialize the channel so cross-tab invalidate messages can be
  // received as soon as we have something worth invalidating.
  getChannel()
}

/**
 * Drop every entry for `groupId` in this tab and broadcast the same
 * invalidate to other tabs of the same browser/origin. Cross-device
 * freshness is handled by the server-side revision probe in the hook,
 * not by this channel.
 */
export function invalidateAggregate(groupId: string): void {
  invalidateInternal(groupId)
  const ch = getChannel()
  if (ch) ch.postMessage({ groupId })
}

export function __resetAggregateCacheForTest(): void {
  cache.clear()
  if (channel) {
    try {
      channel.close()
    } catch {
      // jsdom mock channels may not implement close; safe to ignore.
    }
    channel = null
  }
}
