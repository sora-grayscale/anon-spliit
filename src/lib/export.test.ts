import {
  buildCsvFromGroup,
  buildJsonFromGroup,
  calculateExpenseShareForExport,
  type ExportExpense,
  type ExportGroup,
} from './export'

const baseGroup: ExportGroup = {
  id: 'g1',
  name: 'Trip',
  currency: 'EUR',
  currencyCode: 'EUR',
  participants: [
    { id: 'p1', name: 'Alice' },
    { id: 'p2', name: 'Bob' },
  ],
}

function makeExpense(overrides: Partial<ExportExpense> = {}): ExportExpense {
  return {
    expenseDate: new Date('2026-01-15T00:00:00.000Z'),
    title: 'Dinner',
    categoryId: 7,
    amount: 10000,
    originalAmount: null,
    originalCurrency: null,
    conversionRate: null,
    paidBy: { id: 'p1', name: 'Alice' },
    paidFor: [
      { participant: { id: 'p1', name: 'Alice' }, shares: 1 },
      { participant: { id: 'p2', name: 'Bob' }, shares: 1 },
    ],
    isReimbursement: false,
    splitMode: 'EVENLY',
    ...overrides,
  }
}

describe('calculateExpenseShareForExport', () => {
  test('EVENLY divides equally', () => {
    const e = makeExpense()
    expect(calculateExpenseShareForExport(e, 'p1')).toBe(5000)
    expect(calculateExpenseShareForExport(e, 'p2')).toBe(5000)
  })

  test('BY_SHARES divides proportionally to share weights', () => {
    const e = makeExpense({
      splitMode: 'BY_SHARES',
      paidFor: [
        { participant: { id: 'p1', name: 'Alice' }, shares: 1 },
        { participant: { id: 'p2', name: 'Bob' }, shares: 3 },
      ],
    })
    expect(calculateExpenseShareForExport(e, 'p1')).toBe(2500)
    expect(calculateExpenseShareForExport(e, 'p2')).toBe(7500)
  })

  test('BY_PERCENTAGE applies basis-points (shares / 10000)', () => {
    const e = makeExpense({
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        { participant: { id: 'p1', name: 'Alice' }, shares: 3000 },
        { participant: { id: 'p2', name: 'Bob' }, shares: 7000 },
      ],
    })
    expect(calculateExpenseShareForExport(e, 'p1')).toBe(3000)
    expect(calculateExpenseShareForExport(e, 'p2')).toBe(7000)
  })

  test('BY_AMOUNT returns the share value as-is', () => {
    const e = makeExpense({
      splitMode: 'BY_AMOUNT',
      paidFor: [
        { participant: { id: 'p1', name: 'Alice' }, shares: 4000 },
        { participant: { id: 'p2', name: 'Bob' }, shares: 6000 },
      ],
    })
    expect(calculateExpenseShareForExport(e, 'p1')).toBe(4000)
    expect(calculateExpenseShareForExport(e, 'p2')).toBe(6000)
  })

  test('returns 0 for a participant absent from paidFor', () => {
    expect(calculateExpenseShareForExport(makeExpense(), 'ghost')).toBe(0)
  })

  test('returns 0 when total shares sum to 0', () => {
    const e = makeExpense({
      splitMode: 'BY_SHARES',
      paidFor: [{ participant: { id: 'p1', name: 'Alice' }, shares: 0 }],
    })
    expect(calculateExpenseShareForExport(e, 'p1')).toBe(0)
  })
})

describe('buildCsvFromGroup', () => {
  test('header includes core columns and participant names', () => {
    const csv = buildCsvFromGroup(baseGroup, [makeExpense()])
    const [header] = csv.split('\n')
    expect(header).toContain('"Date"')
    expect(header).toContain('"Description"')
    expect(header).toContain('"Cost"')
    expect(header).toContain('"Alice"')
    expect(header).toContain('"Bob"')
  })

  test('EVENLY: paidBy positive, others negative, equal magnitude', () => {
    const csv = buildCsvFromGroup(baseGroup, [makeExpense()])
    const [, row] = csv.split('\n')
    expect(row).toContain(',50,-50')
  })

  test('BY_AMOUNT: no ratio applied, raw shares used', () => {
    const e = makeExpense({
      splitMode: 'BY_AMOUNT',
      paidFor: [
        { participant: { id: 'p1', name: 'Alice' }, shares: 3000 },
        { participant: { id: 'p2', name: 'Bob' }, shares: 7000 },
      ],
    })
    const csv = buildCsvFromGroup(baseGroup, [e])
    const [, row] = csv.split('\n')
    expect(row).toContain(',30,-70')
  })

  test('BY_PERCENTAGE: shares divided by 10000', () => {
    const e = makeExpense({
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        { participant: { id: 'p1', name: 'Alice' }, shares: 2500 },
        { participant: { id: 'p2', name: 'Bob' }, shares: 7500 },
      ],
    })
    const csv = buildCsvFromGroup(baseGroup, [e])
    const [, row] = csv.split('\n')
    expect(row).toContain(',25,-75')
  })

  test('escapes formula-injection prefix in participant name header', () => {
    const evil: ExportGroup = {
      ...baseGroup,
      participants: [
        { id: 'p1', name: '=cmd|"/c calc"!A1' },
        { id: 'p2', name: 'Bob' },
      ],
    }
    const csv = buildCsvFromGroup(evil, [makeExpense()])
    const [header] = csv.split('\n')
    expect(header).toContain("'=cmd")
  })

  test('CSV body does not include UTF-8 BOM (caller prepends it)', () => {
    const csv = buildCsvFromGroup(baseGroup, [makeExpense()])
    expect(csv.charCodeAt(0)).not.toBe(0xfeff)
  })
})

describe('buildJsonFromGroup', () => {
  test('emits a JSON object with decrypted fields and expense array', () => {
    const json = buildJsonFromGroup(baseGroup, [makeExpense()])
    const parsed = JSON.parse(json) as {
      id: string
      name: string
      currency: string
      participants: Array<{ id: string; name: string }>
      expenses: Array<{ title: string; amount: number }>
    }
    expect(parsed.id).toBe('g1')
    expect(parsed.name).toBe('Trip')
    expect(parsed.currency).toBe('EUR')
    expect(parsed.participants).toEqual(baseGroup.participants)
    expect(parsed.expenses).toHaveLength(1)
    expect(parsed.expenses[0].title).toBe('Dinner')
    expect(parsed.expenses[0].amount).toBe(10000)
  })
})
