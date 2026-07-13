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
 */

const pendingReimbursementAmounts = new Map<string, number>()

function buildKey(groupId: string, from: string, to: string): string {
  return `${groupId}:${from}:${to}`
}

export function setReimbursementAmount(
  groupId: string,
  from: string,
  to: string,
  amount: number,
): void {
  pendingReimbursementAmounts.set(buildKey(groupId, from, to), amount)
}

export function getReimbursementAmount(
  groupId: string,
  from: string,
  to: string,
): number | null {
  return pendingReimbursementAmounts.get(buildKey(groupId, from, to)) ?? null
}
