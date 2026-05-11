'use server'

import { env } from './env'

export async function getRuntimeFeatureFlags() {
  return {
    enableExpenseDocuments: env.NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS,
  }
}

export type RuntimeFeatureFlags = Awaited<
  ReturnType<typeof getRuntimeFeatureFlags>
>
