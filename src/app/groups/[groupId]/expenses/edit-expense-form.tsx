'use client'
import { useEncryption } from '@/components/encryption-provider'
import { decryptExpense, encryptExpenseFormValues } from '@/lib/encrypt-helpers'
import { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { trpc } from '@/trpc/client'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useCurrentGroup } from '../current-group-context'
import { ExpenseForm } from './expense-form'

export function EditExpenseForm({
  groupId,
  expenseId,
  runtimeFeatureFlags,
}: {
  groupId: string
  expenseId: string
  runtimeFeatureFlags: RuntimeFeatureFlags
}) {
  // Use decrypted group data from context
  const { group } = useCurrentGroup()

  const { data: categoriesData } = trpc.categories.list.useQuery()
  const categories = categoriesData?.categories

  const { data: expenseData } = trpc.groups.expenses.get.useQuery({
    groupId,
    expenseId,
  })
  const expense = expenseData?.expense

  const { encryptionKey, isLoading: isKeyLoading, hasKey } = useEncryption()

  const [decryptedExpense, setDecryptedExpense] =
    useState<typeof expense>(undefined)
  const lastDecryptedRef = useRef<{ id: string; withKey: boolean } | null>(null)

  // Decrypt expense when data and key are available
  useEffect(() => {
    let isMounted = true // Track if component is still mounted (Issue #53)

    const shouldDecryptWithKey = hasKey && encryptionKey !== null

    // Skip if already processed with same state
    if (
      expense?.id &&
      lastDecryptedRef.current?.id === expense.id &&
      lastDecryptedRef.current?.withKey === shouldDecryptWithKey
    ) {
      return
    }

    async function decrypt() {
      if (!expense) {
        if (isMounted) setDecryptedExpense(undefined)
        return
      }

      // If no encryption key, use original data
      if (!isKeyLoading && !hasKey) {
        if (isMounted) {
          setDecryptedExpense(expense)
          lastDecryptedRef.current = { id: expense.id, withKey: false }
        }
        return
      }

      if (!encryptionKey) {
        return // Still loading
      }

      try {
        const decrypted = await decryptExpense(expense, encryptionKey)
        if (isMounted) {
          setDecryptedExpense(decrypted)
          lastDecryptedRef.current = { id: expense.id, withKey: true }
        }
      } catch (error) {
        console.warn('Failed to decrypt expense:', error)
        if (isMounted) {
          setDecryptedExpense(expense)
          lastDecryptedRef.current = { id: expense.id, withKey: true }
        }
      }
    }

    decrypt()

    return () => {
      isMounted = false
    }
  }, [expense?.id, encryptionKey, isKeyLoading, hasKey, expense])

  const { mutateAsync: updateExpenseMutateAsync } =
    trpc.groups.expenses.update.useMutation()
  const { mutateAsync: deleteExpenseMutateAsync } =
    trpc.groups.expenses.delete.useMutation()

  const utils = trpc.useUtils()
  const router = useRouter()

  if (!group || !categories || !decryptedExpense) return null

  return (
    <ExpenseForm
      group={group}
      expense={decryptedExpense}
      categories={categories}
      onSubmit={async (expenseFormValues, participantId) => {
        // Encrypt expense data if encryption key is available
        const dataToSend = encryptionKey
          ? await encryptExpenseFormValues(expenseFormValues, encryptionKey)
          : expenseFormValues

        await updateExpenseMutateAsync({
          expenseId,
          groupId,
          expenseFormValues: dataToSend,
          participantId,
        })
        utils.groups.expenses.invalidate()
        router.push(`/groups/${group.id}`)
      }}
      onDelete={async (participantId) => {
        await deleteExpenseMutateAsync({
          expenseId,
          groupId,
          participantId,
        })
        utils.groups.expenses.invalidate()
        router.push(`/groups/${group.id}`)
      }}
      runtimeFeatureFlags={runtimeFeatureFlags}
    />
  )
}
