import { prisma } from '@/lib/prisma'
import { publicProcedure } from '@/trpc/init'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

const revisionInputSchema = z.object({
  groupId: z.string().min(1).max(30),
})

/**
 * Resolver for {@link revisionGroupExpensesProcedure}, exported separately
 * so unit tests can drive it without spinning up the full tRPC router.
 */
export async function revisionHandler({
  input: { groupId },
}: {
  input: z.infer<typeof revisionInputSchema>
}): Promise<{ revision: number }> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { expensesRevision: true },
  })
  if (!group) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' })
  }
  return { revision: group.expensesRevision }
}

/**
 * Cheap single-row SELECT that returns the current `Group.expensesRevision`
 * counter (Issue #225). Clients use this to decide whether their locally
 * cached decrypted expense aggregate is still fresh — matching revision
 * means the cached aggregate is identical to what a full `listAll` drain
 * would produce.
 *
 * The counter is bumped server-side, in the same transaction, by every
 * mutation that affects the `listAll` payload: expense create / update /
 * delete, recurring expense creation, and `updateGroup` (participant
 * renames change `paidBy.name` / `paidFor.participant.name`).
 */
export const revisionGroupExpensesProcedure = publicProcedure
  .input(revisionInputSchema)
  .query(revisionHandler)
