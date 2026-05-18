import { getGroupExpenseCount, getGroupExpenses } from '@/lib/api'
import { publicProcedure } from '@/trpc/init'
import { z } from 'zod'

// Maximum number of expenses to fetch at once (Issue #113)
// Prevents excessive memory usage and DoS via large groups
const MAX_EXPENSES_LIMIT = 10000

/**
 * List all expenses for a group with upper bound limit
 * Used for client-side balance calculation with encrypted amounts.
 *
 * Returns `totalCount` alongside the (possibly truncated) `expenses` so
 * callers like the client-side export (Issue #131) can detect truncation
 * and refuse to emit a partial file. Pagination support for groups
 * exceeding this limit is tracked in Issue #170.
 */
export const listAllGroupExpensesProcedure = publicProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_EXPENSES_LIMIT)
        .optional()
        .default(MAX_EXPENSES_LIMIT),
    }),
  )
  .query(async ({ input: { groupId, limit } }) => {
    // getGroupExpenses internally materializes any due recurring
    // expenses (src/lib/api.ts:432, batched at MAX_BATCH_SIZE so a
    // backlog may still carry over). Read totalCount strictly AFTER it
    // returns so the count reflects the same row set as the slice —
    // otherwise the count could be observed before the batch is
    // inserted, defeating the truncation guard the export flow relies
    // on (Issue #131).
    const expenses = await getGroupExpenses(groupId, { length: limit })
    const totalCount = await getGroupExpenseCount(groupId)
    return {
      expenses: expenses.map((expense) => ({
        ...expense,
        createdAt: new Date(expense.createdAt),
        expenseDate: new Date(expense.expenseDate),
      })),
      totalCount,
    }
  })
