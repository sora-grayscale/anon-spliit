import { deleteGroup } from '@/lib/api'
import { publicProcedure } from '@/trpc/init'
import { z } from 'zod'

export const deleteGroupProcedure = publicProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
    }),
  )
  .mutation(async ({ input: { groupId } }) => {
    await deleteGroup(groupId)
  })
