/**
 * Client-side CSV/JSON export helpers for E2EE groups (Issue #131).
 *
 * These functions receive already-decrypted group and expense data and
 * produce CSV/JSON strings. They must run in the browser because expense
 * amounts/titles/etc. are stored encrypted at rest and only the client
 * holds the encryption key.
 */

import { getCategoryInfo } from '@/app/groups/[groupId]/expenses/category-icon'
import { escapeCsvCell, escapeCsvRow } from '@/lib/csv-injection'
import { getCurrency } from '@/lib/currency'
import { formatAmountAsDecimal, getCurrencyFromGroup } from '@/lib/utils'
import { Parser } from '@json2csv/plainjs'

const splitModeLabel = {
  EVENLY: 'Evenly',
  BY_SHARES: 'Unevenly – By shares',
  BY_PERCENTAGE: 'Unevenly – By percentage',
  BY_AMOUNT: 'Unevenly – By amount',
} as const

export type ExportSplitMode = keyof typeof splitModeLabel

export interface ExportGroup {
  id: string
  name: string
  currency: string
  currencyCode: string | null
  participants: Array<{ id: string; name: string }>
}

export interface ExportExpense {
  expenseDate: Date | string
  title: string
  notes?: string | null
  categoryId?: number | string | null
  amount: number
  originalAmount?: number | null
  originalCurrency?: string | null
  conversionRate?: number | string | null
  paidBy: { id: string; name: string }
  paidFor: Array<{
    participant: { id: string; name: string }
    shares: number
  }>
  isReimbursement: boolean
  splitMode: ExportSplitMode
}

function formatDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d)
  // expenseDate is a Prisma @db.Date stored at UTC midnight; using local
  // components would shift the day by one in west-of-UTC timezones.
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Returns the participant's signed share of `expense.amount` honoring
 * the expense split mode.
 *
 * BY_AMOUNT     : `shares` already stores the participant's amount.
 * BY_PERCENTAGE : `shares` stores percentage × 100 (basis-points).
 * EVENLY/BY_SHARES : proportional to `shares` over the total of all shares.
 */
export function calculateExpenseShareForExport(
  expense: Pick<ExportExpense, 'amount' | 'splitMode' | 'paidFor'>,
  participantId: string,
): number {
  const entry = expense.paidFor.find(
    (pf) => pf.participant.id === participantId,
  )
  if (!entry) return 0
  const share = entry.shares
  switch (expense.splitMode) {
    case 'BY_AMOUNT':
      return share
    case 'BY_PERCENTAGE':
      return (expense.amount * share) / 10000
    case 'EVENLY':
    case 'BY_SHARES': {
      const total = expense.paidFor.reduce((sum, pf) => sum + pf.shares, 0)
      if (total === 0) return 0
      return (expense.amount * share) / total
    }
    default: {
      const _exhaustive: never = expense.splitMode
      throw new Error(`Unknown split mode: ${String(_exhaustive)}`)
    }
  }
}

export function buildCsvFromGroup(
  group: ExportGroup,
  expenses: ExportExpense[],
): string {
  const currency = getCurrencyFromGroup(group)
  const currencyCode = group.currencyCode ?? group.currency

  const fields = [
    { label: 'Date', value: 'date' },
    { label: 'Description', value: 'title' },
    { label: 'Category', value: 'categoryName' },
    { label: 'Currency', value: 'currency' },
    { label: 'Cost', value: 'amount' },
    { label: 'Original cost', value: 'originalAmount' },
    { label: 'Original currency', value: 'originalCurrency' },
    { label: 'Conversion rate', value: 'conversionRate' },
    { label: 'Is Reimbursement', value: 'isReimbursement' },
    { label: 'Split mode', value: 'splitMode' },
    ...group.participants.map((p) => ({
      label: escapeCsvCell(p.name) as string,
      value: p.name,
    })),
  ]

  const rows = expenses.map((expense) => {
    const row: Record<string, unknown> = {
      date: formatDate(expense.expenseDate),
      title: expense.title,
      categoryName: getCategoryInfo(expense.categoryId)?.name || '',
      currency: currencyCode,
      amount: formatAmountAsDecimal(expense.amount, currency),
      originalAmount:
        expense.originalAmount != null && expense.originalCurrency
          ? formatAmountAsDecimal(
              expense.originalAmount,
              getCurrency(expense.originalCurrency),
            )
          : null,
      originalCurrency: expense.originalCurrency ?? null,
      conversionRate:
        expense.conversionRate != null ? String(expense.conversionRate) : null,
      isReimbursement: expense.isReimbursement ? 'Yes' : 'No',
      splitMode: splitModeLabel[expense.splitMode],
    }
    for (const participant of group.participants) {
      const isPaidBy = expense.paidBy.id === participant.id
      const share = calculateExpenseShareForExport(expense, participant.id)
      const decimal = +formatAmountAsDecimal(share, currency)
      row[participant.name] = decimal * (isPaidBy ? 1 : -1)
    }
    return escapeCsvRow(row)
  })

  const parser = new Parser({ fields })
  return parser.parse(rows)
}

export function buildJsonFromGroup(
  group: ExportGroup,
  expenses: ExportExpense[],
): string {
  return JSON.stringify({ ...group, expenses }, null, 2)
}
