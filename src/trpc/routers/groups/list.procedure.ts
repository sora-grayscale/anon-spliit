import { getGroups } from '@/lib/api'
import { publicProcedure } from '@/trpc/init'
import { z } from 'zod'

export const listGroupsProcedure = publicProcedure
  .input(
    z.object({
      groupIds: z.array(z.string().min(1).max(30)).max(100),
    }),
  )
  .query(async ({ input: { groupIds } }) => {
    const groups = await getGroups(groupIds)
    return { groups }
  })
