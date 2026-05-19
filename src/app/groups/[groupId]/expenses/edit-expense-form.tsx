'use client'
import { useEncryption } from '@/components/encryption-provider'
import { decryptExpense, encryptExpenseFormValues } from '@/lib/encrypt-helpers'
import { invalidateAggregate } from '@/lib/hooks/aggregateCache'
import { trpc } from '@/trpc/client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useCurrentGroup } from '../current-group-context'
import { ExpenseForm } from './expense-form'

export function EditExpenseForm({
  groupId,
  expenseId,
}: {
  groupId: string
  expenseId: string
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

  // Decrypt the expense whenever the upstream tRPC query produces a new
  // reference (e.g. after a cross-tab edit triggers a refetch). The dep array
  // alone is enough — Issue #171's previous ID-only dedup was redundant and
  // wrongly suppressed re-decrypt when the content changed for the same id.
  // The isMounted cleanup prevents a late async setState after unmount
  // (Issue #53).
  const [decryptedExpense, setDecryptedExpense] =
    useState<typeof expense>(undefined)

  useEffect(() => {
    let isMounted = true

    async function decrypt() {
      if (!expense) {
        if (isMounted) setDecryptedExpense(undefined)
        return
      }

      // If no encryption key, use original data
      if (!isKeyLoading && !hasKey) {
        if (isMounted) setDecryptedExpense(expense)
        return
      }

      if (!encryptionKey) {
        return // Still loading
      }

      try {
        const decrypted = await decryptExpense(expense, encryptionKey)
        if (isMounted) setDecryptedExpense(decrypted)
      } catch (error) {
        console.warn('Failed to decrypt expense:', error)
        if (isMounted) setDecryptedExpense(expense)
      }
    }

    decrypt()

    return () => {
      isMounted = false
    }
  }, [expense, encryptionKey, isKeyLoading, hasKey])

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
        // Issue #225: drop the decrypted-aggregate cache BEFORE awaiting the
        // react-query invalidate so a rejected invalidate cannot leave a
        // stale cache entry visible on the next balances/stats visit.
        invalidateAggregate(groupId)
        try {
          await utils.groups.expenses.invalidate()
        } catch (error) {
          // The mutation already succeeded server-side; we still need to
          // navigate so the user is not stuck on the form. The stale cache
          // will be refreshed on the next interaction.
          console.warn('Failed to invalidate expenses cache:', error)
        } finally {
          router.push(`/groups/${group.id}`)
        }
      }}
      onDelete={async (participantId) => {
        await deleteExpenseMutateAsync({
          expenseId,
          groupId,
          participantId,
        })
        // Issue #225: drop the decrypted-aggregate cache BEFORE awaiting the
        // react-query invalidate so a rejected invalidate cannot leave a
        // stale cache entry visible on the next balances/stats visit.
        invalidateAggregate(groupId)
        try {
          await utils.groups.expenses.invalidate()
        } catch (error) {
          console.warn('Failed to invalidate expenses cache:', error)
        } finally {
          router.push(`/groups/${group.id}`)
        }
      }}
    />
  )
}
