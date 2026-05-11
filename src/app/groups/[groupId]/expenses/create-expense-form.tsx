'use client'
import { useEncryption } from '@/components/encryption-provider'
import { encryptExpenseFormValues } from '@/lib/encrypt-helpers'
import { trpc } from '@/trpc/client'
import { useRouter } from 'next/navigation'
import { useCurrentGroup } from '../current-group-context'
import { ExpenseForm } from './expense-form'

export function CreateExpenseForm({
  groupId,
}: {
  groupId: string
  expenseId?: string
}) {
  // Use decrypted group data from context
  const { group } = useCurrentGroup()

  const { data: categoriesData } = trpc.categories.list.useQuery()
  const categories = categoriesData?.categories

  const { encryptionKey } = useEncryption()

  const { mutateAsync: createExpenseMutateAsync } =
    trpc.groups.expenses.create.useMutation()

  const utils = trpc.useUtils()
  const router = useRouter()

  if (!group || !categories) return null

  return (
    <ExpenseForm
      group={group}
      categories={categories}
      onSubmit={async (expenseFormValues, participantId) => {
        // Encrypt expense data if encryption key is available
        const dataToSend = encryptionKey
          ? await encryptExpenseFormValues(expenseFormValues, encryptionKey)
          : expenseFormValues

        await createExpenseMutateAsync({
          groupId,
          expenseFormValues: dataToSend,
          participantId,
        })
        utils.groups.expenses.invalidate()
        router.push(`/groups/${group.id}`)
      }}
    />
  )
}
