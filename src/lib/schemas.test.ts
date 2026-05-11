/**
 * Tests for schema-level bounds enforcement (Issue #133)
 */

import {
  EXPENSE_DATE_MAX_YEARS_FUTURE,
  EXPENSE_DATE_MIN_YEARS_PAST,
  expenseFormSchema,
} from './schemas'

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000

// Helper to build a minimal valid input
function makeBaseExpense(overrides: Record<string, unknown> = {}) {
  return {
    title: 'lunch',
    amount: 1000,
    paidBy: 'p1',
    paidFor: [{ participant: 'p1', shares: 1 }],
    splitMode: 'EVENLY',
    saveDefaultSplittingOptions: false,
    isReimbursement: false,
    notes: undefined,
    recurrenceRule: 'NONE',
    category: 0,
    ...overrides,
  }
}

describe('expenseFormSchema expenseDate bounds (Issue #133)', () => {
  it('accepts current date', () => {
    const result = expenseFormSchema.safeParse(
      makeBaseExpense({ expenseDate: new Date() }),
    )
    expect(result.success).toBe(true)
  })

  it('accepts date 1 year in the past', () => {
    const oneYearAgo = new Date(Date.now() - MS_PER_YEAR)
    const result = expenseFormSchema.safeParse(
      makeBaseExpense({ expenseDate: oneYearAgo }),
    )
    expect(result.success).toBe(true)
  })

  it('accepts date near the past boundary', () => {
    const nearBoundary = new Date(
      Date.now() - (EXPENSE_DATE_MIN_YEARS_PAST - 0.01) * MS_PER_YEAR,
    )
    const result = expenseFormSchema.safeParse(
      makeBaseExpense({ expenseDate: nearBoundary }),
    )
    expect(result.success).toBe(true)
  })

  it('rejects date too far in the past', () => {
    const tooOld = new Date(
      Date.now() - (EXPENSE_DATE_MIN_YEARS_PAST + 1) * MS_PER_YEAR,
    )
    const result = expenseFormSchema.safeParse(
      makeBaseExpense({ expenseDate: tooOld }),
    )
    expect(result.success).toBe(false)
    if (!result.success) {
      const dateIssue = result.error.issues.find((i) =>
        i.path.includes('expenseDate'),
      )
      expect(dateIssue?.message).toBe('expenseDateTooOld')
    }
  })

  it('rejects date 10 years in the past (DoS prevention)', () => {
    const tenYearsAgo = new Date(Date.now() - 10 * MS_PER_YEAR)
    const result = expenseFormSchema.safeParse(
      makeBaseExpense({ expenseDate: tenYearsAgo }),
    )
    expect(result.success).toBe(false)
  })

  it('accepts date within future bound', () => {
    const sixMonthsFromNow = new Date(Date.now() + MS_PER_YEAR / 2)
    const result = expenseFormSchema.safeParse(
      makeBaseExpense({ expenseDate: sixMonthsFromNow }),
    )
    expect(result.success).toBe(true)
  })

  it('rejects date too far in the future', () => {
    const tooFuture = new Date(
      Date.now() + (EXPENSE_DATE_MAX_YEARS_FUTURE + 1) * MS_PER_YEAR,
    )
    const result = expenseFormSchema.safeParse(
      makeBaseExpense({ expenseDate: tooFuture }),
    )
    expect(result.success).toBe(false)
    if (!result.success) {
      const dateIssue = result.error.issues.find((i) =>
        i.path.includes('expenseDate'),
      )
      expect(dateIssue?.message).toBe('expenseDateTooFuture')
    }
  })

  it('coerces ISO date strings within bounds', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const result = expenseFormSchema.safeParse(
      makeBaseExpense({ expenseDate: yesterday.toISOString() }),
    )
    expect(result.success).toBe(true)
  })
})
