import { permanentlyDeleteGroup } from '@/lib/api'
import { publicProcedure } from '@/trpc/init'
import { z } from 'zod'

export const permanentDeleteGroupProcedure = publicProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
    }),
  )
  .mutation(async ({ input: { groupId } }) => {
    await permanentlyDeleteGroup(groupId)
  })
