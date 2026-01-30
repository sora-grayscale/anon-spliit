import { restoreGroup } from '@/lib/api'
import { createRateLimitedProcedure } from '@/trpc/init'
import { z } from 'zod'

// Rate limit: 10 restore attempts per hour per groupId (Issue #78)
const HOUR_MS = 60 * 60 * 1000

export const restoreGroupProcedure = createRateLimitedProcedure(
  'restore',
  10,
  HOUR_MS,
)
  .input(
    z.object({
      groupId: z.string().min(1).max(30),
    }),
  )
  .mutation(async ({ input: { groupId } }) => {
    await restoreGroup(groupId)
  })
