/**
 * In-memory store for the reimbursement "Mark as paid" prefill amount.
 *
 * The suggested reimbursement amount is derived on the client from decrypted
 * balances and is therefore plaintext financial data. It must never be placed
 * in the URL query string: navigating to the (server-rendered) create-expense
 * route would transmit the query to the server via the RSC fetch (or a full
 * reload), leaking the amount into server/proxy access logs and breaking the
 * E2EE invariant that the server never receives plaintext.
 *
 * We keep it in a module-level map instead. It survives client-side navigation
 * but is never sent to the server. On a full reload the entry is absent and the
 * amount falls back to 0 (the from/to participants are still prefilled from the
 * query, which only contains pseudonymous participant ids already visible to
 * the server).
 *
 * Lifecycle: the amount is set on the "Mark as paid" click, read once as the
 * create-form default value, and cleared by the form in a mount effect. Because
 * the entry lives only in this process's memory, a hard reload finds nothing and
 * the amount falls back to 0 by design — privacy is chosen over convenience.
 */

const pendingReimbursementAmounts = new Map<string, number>()

function buildKey(groupId: string, from: string, to: string): string {
  // JSON.stringify the id tuple so the parts can never collide regardless of
  // which delimiter characters an id happens to contain.
  return JSON.stringify([groupId, from, to])
}

export function setReimbursementAmount(
  groupId: string,
  from: string,
  to: string,
  amount: number,
): void {
  // This store is client-only. A server-side write would share one user's
  // plaintext amount across every request handled by the Node process
  // (cross-tenant leak).
  if (typeof window === 'undefined') return
  pendingReimbursementAmounts.set(buildKey(groupId, from, to), amount)
}

export function getReimbursementAmount(
  groupId: string,
  from: string,
  to: string,
): number | null {
  return pendingReimbursementAmounts.get(buildKey(groupId, from, to)) ?? null
}

export function clearReimbursementAmount(
  groupId: string,
  from: string,
  to: string,
): void {
  pendingReimbursementAmounts.delete(buildKey(groupId, from, to))
}
