import { createTRPCRouter } from '@/trpc/init'
import { activitiesRouter } from '@/trpc/routers/groups/activities'
import { createGroupProcedure } from '@/trpc/routers/groups/create.procedure'
import { deleteGroupProcedure } from '@/trpc/routers/groups/delete.procedure'
import { groupExpensesRouter } from '@/trpc/routers/groups/expenses'
import { getGroupProcedure } from '@/trpc/routers/groups/get.procedure'
import { updateGroupProcedure } from '@/trpc/routers/groups/update.procedure'
import { getGroupDetailsProcedure } from './getDetails.procedure'
import { listGroupsProcedure } from './list.procedure'
import { permanentDeleteGroupProcedure } from './permanentDelete.procedure'
import { restoreGroupProcedure } from './restore.procedure'

export const groupsRouter = createTRPCRouter({
  expenses: groupExpensesRouter,
  activities: activitiesRouter,

  get: getGroupProcedure,
  getDetails: getGroupDetailsProcedure,
  list: listGroupsProcedure,
  create: createGroupProcedure,
  update: updateGroupProcedure,
  delete: deleteGroupProcedure,
  restore: restoreGroupProcedure,
  permanentDelete: permanentDeleteGroupProcedure,
})
