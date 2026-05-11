import { auth } from '@/lib/auth'
import { env } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import contentDisposition from 'content-disposition'
import { NextResponse } from 'next/server'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  // Require authentication in private instance mode (Issue #136). Public
  // instances still use the share-by-URL model (encryption key in fragment).
  if (env.PRIVATE_INSTANCE) {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 },
      )
    }
    if (session.user.requiresTwoFactor) {
      return NextResponse.json(
        { error: 'Two-factor authentication required' },
        { status: 401 },
      )
    }
    if (session.user.mustChangePassword) {
      return NextResponse.json(
        { error: 'Password change required' },
        { status: 403 },
      )
    }
  }

  const { groupId } = await params
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      name: true,
      currency: true,
      currencyCode: true,
      expenses: {
        select: {
          createdAt: true,
          expenseDate: true,
          title: true,
          categoryId: true, // Encrypted category ID (Issue #19 - E2EE)
          amount: true,
          originalAmount: true,
          originalCurrency: true,
          conversionRate: true,
          paidById: true,
          paidFor: { select: { participantId: true, shares: true } },
          isReimbursement: true,
          splitMode: true,
          recurrenceRule: true,
        },
        orderBy: [{ expenseDate: 'asc' }, { createdAt: 'asc' }],
      },
      participants: { select: { id: true, name: true } },
    },
  })
  if (!group)
    return NextResponse.json({ error: 'Invalid group ID' }, { status: 404 })

  const date = new Date().toISOString().split('T')[0]
  const filename = `Spliit Export - ${date}`
  return NextResponse.json(group, {
    headers: {
      'content-type': 'application/json',
      'content-disposition': contentDisposition(`${filename}.json`),
    },
  })
}
