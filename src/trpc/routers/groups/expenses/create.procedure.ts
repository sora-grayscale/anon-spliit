import { createExpense } from '@/lib/api'
import { expenseFormSchema } from '@/lib/schemas'
import { createRateLimitedProcedure } from '@/trpc/init'
import { z } from 'zod'

// Rate limit: 100 expense creations per hour per groupId (Issue #78)
const HOUR_MS = 60 * 60 * 1000

export const createGroupExpenseProcedure = createRateLimitedProcedure(
  'create-expense',
  100,
  HOUR_MS,
)
  .input(
    z.object({
      groupId: z.string().min(1).max(30),
      expenseFormValues: expenseFormSchema,
      participantId: z.string().optional(),
    }),
  )
  .mutation(
    async ({ input: { groupId, expenseFormValues, participantId } }) => {
      const expense = await createExpense(
        expenseFormValues,
        groupId,
        participantId,
      )
      return { expenseId: expense.id }
    },
  )
