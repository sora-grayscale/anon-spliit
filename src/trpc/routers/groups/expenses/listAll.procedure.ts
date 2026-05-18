import { getGroupExpenses } from '@/lib/api'
import { publicProcedure } from '@/trpc/init'
import { z } from 'zod'

const DEFAULT_PAGE_SIZE = 200
const MAX_PAGE_SIZE = 500

/**
 * List a single page of expenses for a group using stable keyset (cursor)
 * pagination.
 *
 * Used for client-side balance calculation and export (Issue #170). Each
 * page returns up to `limit` rows in `(expenseDate DESC, createdAt DESC,
 * id DESC)` order; `id` is the final tie-breaker so two rows sharing
 * `expenseDate` and `createdAt` never cause skip or duplication at page
 * boundaries.
 *
 * Wire contract for the cursor: `expenseDate` and `createdAt` travel as
 * ISO 8601 strings (`z.string().datetime()`). The procedure converts them
 * to `Date` for the Prisma keyset query and emits ISO strings on the way
 * back out in `nextCursor`.
 *
 * `nextCursor` is derived from the **last returned row** — not from a
 * lookahead row — so the client can resume paging without skipping a
 * record. To detect end-of-data the procedure fetches `limit + 1` rows;
 * the extra row is discarded from the response and only used to decide
 * whether `nextCursor` should be non-null.
 *
 * Pass `cursor: undefined` (or omit) for the first page. Continue paging
 * until `nextCursor === null`.
 */
const listAllInputSchema = z.object({
  groupId: z.string().min(1),
  cursor: z
    .object({
      expenseDate: z.string().datetime(),
      createdAt: z.string().datetime(),
      id: z.string().min(1),
    })
    .optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .optional()
    .default(DEFAULT_PAGE_SIZE),
})

/**
 * Resolver for {@link listAllGroupExpensesProcedure}, exported separately
 * so unit tests can drive it without spinning up the full tRPC router.
 */
export async function listAllHandler({
  input: { groupId, cursor, limit },
}: {
  input: z.infer<typeof listAllInputSchema>
}) {
  const cursorAsDate = cursor
    ? {
        expenseDate: new Date(cursor.expenseDate),
        createdAt: new Date(cursor.createdAt),
        id: cursor.id,
      }
    : undefined

  // Lookahead: fetch limit + 1 rows so we can tell whether another page
  // exists, but never return the extra row to the client. nextCursor is
  // derived from the LAST RETURNED row (Issue #170).
  const rows = await getGroupExpenses(groupId, {
    cursor: cursorAsDate,
    limit: limit + 1,
  })

  const hasMore = rows.length > limit
  const returned = hasMore ? rows.slice(0, limit) : rows
  const lastReturned = returned[returned.length - 1]

  const nextCursor =
    hasMore && lastReturned
      ? {
          expenseDate: lastReturned.expenseDate.toISOString(),
          createdAt: lastReturned.createdAt.toISOString(),
          id: lastReturned.id,
        }
      : null

  return {
    expenses: returned.map((expense) => ({
      ...expense,
      createdAt: new Date(expense.createdAt),
      expenseDate: new Date(expense.expenseDate),
    })),
    nextCursor,
  }
}

export const listAllGroupExpensesProcedure = publicProcedure
  .input(listAllInputSchema)
  .query(listAllHandler)
