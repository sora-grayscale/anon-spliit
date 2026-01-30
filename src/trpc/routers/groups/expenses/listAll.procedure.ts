import { getGroupExpenses } from '@/lib/api'
import { publicProcedure } from '@/trpc/init'
import { z } from 'zod'

/**
 * List all expenses for a group (no pagination)
 * Used for client-side balance calculation with encrypted amounts
 */
export const listAllGroupExpensesProcedure = publicProcedure
  .input(z.object({ groupId: z.string().min(1) }))
  .query(async ({ input: { groupId } }) => {
    const expenses = await getGroupExpenses(groupId)
    return {
      expenses: expenses.map((expense) => ({
        ...expense,
        createdAt: new Date(expense.createdAt),
        expenseDate: new Date(expense.expenseDate),
      })),
    }
  })
