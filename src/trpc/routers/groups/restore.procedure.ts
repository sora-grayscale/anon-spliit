import { restoreGroup } from '@/lib/api'
import { publicProcedure } from '@/trpc/init'
import { z } from 'zod'

export const restoreGroupProcedure = publicProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
    }),
  )
  .mutation(async ({ input: { groupId } }) => {
    await restoreGroup(groupId)
  })
