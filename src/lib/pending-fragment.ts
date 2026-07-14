/**
 * In-memory store for a URL fragment (E2EE key material) across the 2FA
 * verification redirect.
 *
 * When TwoFactorGuard intercepts a navigation such as `/groups/<id>#<key>`,
 * it redirects to `/auth/verify-2fa?callbackUrl=<path>`. The fragment is the
 * group's encryption key: it must never ride on `callbackUrl`, because the
 * query string is sent to the server on navigation (RSC fetch or a full
 * reload), which would break the E2EE invariant that the server never
 * receives key material. sessionStorage is ruled out for the same reason we
 * avoid it elsewhere: it would persist the key at rest beyond the redirect's
 * lifetime.
 *
 * Instead the guard parks the fragment here, in module memory, bound to the
 * destination path, and the verification pages re-attach it after a
 * successful 2FA check. A hard reload during verification loses the entry
 * and the user lands on the key-entry screen exactly as before this store
 * existed — privacy is chosen over convenience (the same trade-off as
 * reimbursement-prefill).
 *
 * A single slot (not a map) is deliberate: only the most recent interception
 * can still be completed, and one slot keeps at most one copy of key
 * material in process memory.
 */

let pendingPath: string | null = null
let pendingFragment: string | null = null

export function setPendingFragment(path: string, fragment: string): void {
  // Client-only: a server-side write would share one user's key material
  // across every request handled by the Node process (cross-tenant leak).
  if (typeof window === 'undefined') return
  // Ignore empty writes: by the time a caller re-runs after the redirect has
  // already stripped the hash from the address bar, an empty capture must
  // not clobber the fragment that was just parked.
  if (!fragment) return
  pendingPath = path
  pendingFragment = fragment
}

/**
 * One-shot read: returns the fragment if it was captured for exactly this
 * path and clears the slot. A mismatched path returns null and leaves the
 * slot intact — a fragment may only re-attach to the destination it was
 * captured on, never to a different page's URL.
 */
export function takePendingFragment(path: string): string | null {
  if (pendingFragment === null || pendingPath !== path) return null
  const fragment = pendingFragment
  pendingPath = null
  pendingFragment = null
  return fragment
}

/**
 * Re-attach a pending fragment to `callbackUrl` if one was captured for it.
 * A hash already present on `callbackUrl` is replaced in that case (it
 * survived a query-string round-trip, so it was server-visible and cannot be
 * the key the guard captured); when nothing is pending the URL is returned
 * untouched.
 */
export function restorePendingFragment(callbackUrl: string): string {
  const base = callbackUrl.split('#')[0]
  const fragment = takePendingFragment(base)
  return fragment === null ? callbackUrl : `${base}#${fragment}`
}
