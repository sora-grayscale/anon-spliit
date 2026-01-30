import { createExpense } from '@/lib/api'
import { expenseFormSchema } from '@/lib/schemas'
import { publicProcedure } from '@/trpc/init'
import { z } from 'zod'

export const createGroupExpenseProcedure = publicProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
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
