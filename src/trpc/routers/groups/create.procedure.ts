import { createGroup } from '@/lib/api'
import { groupFormSchema } from '@/lib/schemas'
import { publicProcedure } from '@/trpc/init'
import { z } from 'zod'

export const createGroupProcedure = publicProcedure
  .input(
    z.object({
      groupFormValues: groupFormSchema,
    }),
  )
  .mutation(async ({ input: { groupFormValues } }) => {
    const group = await createGroup(groupFormValues)
    return { groupId: group.id }
  })
