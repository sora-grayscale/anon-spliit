import GroupExpensesPageClient from '@/app/groups/[groupId]/expenses/page.client'
import { Metadata } from 'next'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Expenses',
}

export default async function GroupExpensesPage() {
  return <GroupExpensesPageClient />
}
