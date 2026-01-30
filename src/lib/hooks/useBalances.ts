'use client'

import { useEncryption } from '@/components/encryption-provider'
import {
  Balances,
  getBalances,
  getPublicBalances,
  getSuggestedReimbursements,
  Reimbursement,
} from '@/lib/balances'
import { decryptExpenses } from '@/lib/encrypt-helpers'
import { trpc } from '@/trpc/client'
import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Hook for calculating balances on the client side
 * This handles decryption of amounts for encrypted groups
 */
export function useBalances(groupId: string) {
  const { encryptionKey, isLoading: isKeyLoading, hasKey } = useEncryption()

  // Fetch all expenses for this group (without pagination for balance calculation)
  const { data: expensesData, isLoading: expensesAreLoading } =
    trpc.groups.expenses.listAll.useQuery({ groupId })

  const rawExpenses = expensesData?.expenses

  // Handle async decryption
  const [decryptedExpenses, setDecryptedExpenses] =
    useState<typeof rawExpenses>(undefined)
  // Track decryption errors to show user feedback (Issue #80)
  const [decryptionError, setDecryptionError] = useState<Error | null>(null)
  const lastDecryptedRef = useRef<{ key: string; withKey: boolean } | null>(
    null,
  )

  useEffect(() => {
    let isMounted = true
    const expenseIds = rawExpenses?.map((e) => e.id).join(',') || ''
    const shouldDecryptWithKey = hasKey && encryptionKey !== null

    // Skip if already processed with same state
    if (
      lastDecryptedRef.current?.key === expenseIds &&
      lastDecryptedRef.current?.withKey === shouldDecryptWithKey
    ) {
      return
    }

    async function decrypt() {
      if (!rawExpenses) {
        if (isMounted) {
          setDecryptedExpenses(undefined)
          setDecryptionError(null)
        }
        return
      }

      // If no encryption key, use original data (unencrypted group)
      if (!isKeyLoading && !hasKey) {
        if (isMounted) {
          setDecryptedExpenses(rawExpenses)
          setDecryptionError(null)
          lastDecryptedRef.current = { key: expenseIds, withKey: false }
        }
        return
      }

      if (!encryptionKey) {
        return // Still loading
      }

      try {
        const decrypted = await decryptExpenses(rawExpenses, encryptionKey)
        if (isMounted) {
          setDecryptedExpenses(decrypted)
          setDecryptionError(null)
          lastDecryptedRef.current = { key: expenseIds, withKey: true }
        }
      } catch (error) {
        // Issue #80: Don't fall back to encrypted data - it causes wrong balance calculations
        console.error(
          'Failed to decrypt expenses for balance calculation:',
          error,
        )
        if (isMounted) {
          setDecryptedExpenses([]) // Use empty array, not encrypted data
          setDecryptionError(
            error instanceof Error
              ? error
              : new Error('Failed to decrypt expense data'),
          )
          lastDecryptedRef.current = { key: expenseIds, withKey: true }
        }
      }
    }

    decrypt()

    return () => {
      isMounted = false
    }
  }, [rawExpenses, encryptionKey, isKeyLoading, hasKey])

  // Calculate balances from decrypted expenses
  const { balances, reimbursements } = useMemo(() => {
    if (!decryptedExpenses || decryptedExpenses.length === 0) {
      return { balances: {} as Balances, reimbursements: [] as Reimbursement[] }
    }

    const calculatedBalances = getBalances(decryptedExpenses)
    const calculatedReimbursements =
      getSuggestedReimbursements(calculatedBalances)
    const publicBalances = getPublicBalances(calculatedReimbursements)

    return {
      balances: publicBalances,
      reimbursements: calculatedReimbursements,
    }
  }, [decryptedExpenses])

  const isLoading = expensesAreLoading || isKeyLoading || !decryptedExpenses

  return {
    balances,
    reimbursements,
    isLoading,
    expenses: decryptedExpenses,
    // Issue #80: Expose decryption error for UI feedback
    decryptionError,
  }
}
