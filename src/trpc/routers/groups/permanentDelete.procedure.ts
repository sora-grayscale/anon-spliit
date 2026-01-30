import { permanentlyDeleteGroup } from '@/lib/api'
import { createRateLimitedProcedure } from '@/trpc/init'
import { z } from 'zod'

// Rate limit: 5 permanent delete attempts per hour per groupId (Issue #78)
const HOUR_MS = 60 * 60 * 1000

export const permanentDeleteGroupProcedure = createRateLimitedProcedure(
  'permanent-delete',
  5,
  HOUR_MS,
)
  .input(
    z.object({
      groupId: z.string().min(1).max(30),
    }),
  )
  .mutation(async ({ input: { groupId } }) => {
    await permanentlyDeleteGroup(groupId)
  })
