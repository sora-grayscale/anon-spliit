import { getGroup } from '@/lib/api'
import { publicProcedure } from '@/trpc/init'
import { z } from 'zod'

export const getGroupProcedure = publicProcedure
  .input(z.object({ groupId: z.string().min(1) }))
  .query(async ({ input: { groupId } }) => {
    const group = await getGroup(groupId)
    return { group }
  })
