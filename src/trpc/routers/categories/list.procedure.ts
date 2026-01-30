import { getCategories } from '@/lib/api'
import { publicProcedure } from '@/trpc/init'

export const listCategoriesProcedure = publicProcedure.query(async () => {
  return { categories: await getCategories() }
})
