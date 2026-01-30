import { getActivities } from '@/lib/api'
import { publicProcedure } from '@/trpc/init'
import { z } from 'zod'

export const listGroupActivitiesProcedure = publicProcedure
  .input(
    z.object({
      groupId: z.string().min(1).max(30), // nanoid is typically 21 chars
      cursor: z.number().int().min(0).max(100000).optional().default(0), // Pagination offset
      limit: z.number().int().min(1).max(100).optional().default(5), // Max 100 items per request
    }),
  )
  .query(async ({ input: { groupId, cursor, limit } }) => {
    const activities = await getActivities(groupId, {
      offset: cursor,
      length: limit + 1,
    })
    return {
      activities: activities.slice(0, limit),
      hasMore: !!activities[limit],
      nextCursor: cursor + limit,
    }
  })
