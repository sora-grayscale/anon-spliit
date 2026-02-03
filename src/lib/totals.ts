import { getGroupExpenses } from '@/lib/api'
import { toNumber } from '@/lib/utils'

/**
 * Generic expense type for totals calculation
 */
export interface ExpenseForTotals {
  amount: string | number
  splitMode: 'EVENLY' | 'BY_SHARES' | 'BY_PERCENTAGE' | 'BY_AMOUNT'
  isReimbursement: boolean
  paidBy: { id: string }
  paidFor: Array<{
    shares: string | number
    participant: { id: string }
  }>
}

export function getTotalGroupSpending(
  expenses:
    | NonNullable<Awaited<ReturnType<typeof getGroupExpenses>>>
    | ExpenseForTotals[],
): number {
  return expenses.reduce(
    (total, expense) =>
      expense.isReimbursement ? total : total + toNumber(expense.amount),
    0,
  )
}

export function getTotalActiveUserPaidFor(
  activeUserId: string | null,
  expenses:
    | NonNullable<Awaited<ReturnType<typeof getGroupExpenses>>>
    | ExpenseForTotals[],
): number {
  return expenses.reduce(
    (total, expense) =>
      expense.paidBy.id === activeUserId && !expense.isReimbursement
        ? total + toNumber(expense.amount)
        : total,
    0,
  )
}

/**
 * Generic type for expense that can be used with calculateShare
 */
type ExpenseForShare = {
  amount: string | number
  splitMode: 'EVENLY' | 'BY_SHARES' | 'BY_PERCENTAGE' | 'BY_AMOUNT'
  isReimbursement: boolean
  paidFor: Array<{
    shares: string | number
    participant: { id: string }
  }>
}

export function calculateShare(
  participantId: string | null,
  expense: ExpenseForShare,
): number {
  if (expense.isReimbursement) return 0

  const paidFors = expense.paidFor
  const userPaidFor = paidFors.find(
    (paidFor) => paidFor.participant.id === participantId,
  )

  if (!userPaidFor) return 0

  const shares = toNumber(userPaidFor.shares)
  const expenseAmount = toNumber(expense.amount)

  switch (expense.splitMode) {
    case 'EVENLY':
      // Divide the total expense evenly among all participants
      return expenseAmount / paidFors.length
    case 'BY_AMOUNT':
      // Directly add the user's share if the split mode is BY_AMOUNT
      return shares
    case 'BY_PERCENTAGE':
      // Calculate the user's share based on their percentage of the total expense
      return (expenseAmount * shares) / 10000 // Assuming shares are out of 10000 for percentage
    case 'BY_SHARES':
      // Calculate the user's share based on their shares relative to the total shares
      const totalShares = paidFors.reduce(
        (sum, paidFor) => sum + toNumber(paidFor.shares),
        0,
      )
      return (expenseAmount * shares) / totalShares
    default:
      return 0
  }
}

export function getTotalActiveUserShare(
  activeUserId: string | null,
  expenses:
    | NonNullable<Awaited<ReturnType<typeof getGroupExpenses>>>
    | ExpenseForTotals[],
): number {
  const total = expenses.reduce(
    (sum, expense) => sum + calculateShare(activeUserId, expense),
    0,
  )

  return parseFloat(total.toFixed(2))
}
