'use client'

import {
  Balances,
  getBalances,
  getPublicBalances,
  getSuggestedReimbursements,
  Reimbursement,
} from '@/lib/balances'
import { useAllGroupExpenses } from '@/lib/hooks/useAllGroupExpenses'
import { useMemo } from 'react'

/**
 * Compute balances/reimbursements on the client side from fully decrypted
 * expenses (Issue #170: backed by cursor pagination + page-wise decryption
 * via {@link useAllGroupExpenses}).
 *
 * `queryError` and `decryptionError` are surfaced separately so callers can
 * present distinct UI: a network/server failure vs. a key/ciphertext
 * problem. On decryption failure, balances/reimbursements stay empty —
 * encrypted ciphertext is never used as a fallback (Issue #80).
 */
export function useBalances(groupId: string) {
  const { expenses, isLoading, queryError, decryptionError } =
    useAllGroupExpenses(groupId, { autoDrain: true })

  const { balances, reimbursements } = useMemo(() => {
    if (!expenses || expenses.length === 0) {
      return { balances: {} as Balances, reimbursements: [] as Reimbursement[] }
    }

    const calculatedBalances = getBalances(expenses)
    const calculatedReimbursements =
      getSuggestedReimbursements(calculatedBalances)
    const publicBalances = getPublicBalances(calculatedReimbursements)

    return {
      balances: publicBalances,
      reimbursements: calculatedReimbursements,
    }
  }, [expenses])

  return {
    balances,
    reimbursements,
    isLoading,
    expenses,
    queryError,
    decryptionError,
  }
}
