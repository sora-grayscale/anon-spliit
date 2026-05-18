jest.mock('@/lib/api', () => ({
  getGroupExpenses: jest.fn(),
}))
// Avoid pulling auth.ts (and its ESM @auth/prisma-adapter dep) into jest by
// stubbing the procedure builder. The handler itself doesn't need it.
jest.mock('@/trpc/init', () => ({
  publicProcedure: {
    input: () => ({ query: () => ({}) }),
  },
}))

import { getGroupExpenses } from '@/lib/api'
import { listAllHandler } from './listAll.procedure'

const mockGetGroupExpenses = getGroupExpenses as jest.MockedFunction<
  typeof getGroupExpenses
>

type Row = {
  id: string
  expenseDate: Date
  createdAt: Date
  // Fill in only the few fields the handler echoes back; spread of the rest
  // is irrelevant for cursor pagination semantics.
  title: string
  amount: string
  paidBy: { id: string; name: string }
  paidFor: []
  // The handler returns all selected columns, but for assertions about
  // cursor behaviour we only need id/expenseDate/createdAt.
}

function makeRow(
  id: string,
  expenseDate: Date,
  createdAt: Date = expenseDate,
): Row {
  return {
    id,
    expenseDate,
    createdAt,
    title: `t-${id}`,
    amount: '100',
    paidBy: { id: 'p1', name: 'Alice' },
    paidFor: [],
  }
}

describe('listAllGroupExpensesProcedure handler (Issue #170)', () => {
  beforeEach(() => {
    mockGetGroupExpenses.mockReset()
  })

  it('requests limit + 1 rows so a lookahead can detect more pages', async () => {
    mockGetGroupExpenses.mockResolvedValue([])
    await listAllHandler({ input: { groupId: 'g1', limit: 200 } })
    expect(mockGetGroupExpenses).toHaveBeenCalledWith('g1', {
      cursor: undefined,
      limit: 201,
    })
  })

  it('does NOT include the lookahead row in the returned expenses', async () => {
    // Note: zero-pad the day component — JS Date does not accept "2026-05-9".
    const d = (n: number) =>
      new Date(`2026-05-${String(10 - n).padStart(2, '0')}T12:00:00.000Z`)
    // 4 rows when limit=3: the 4th is the lookahead and must not be returned.
    const rows = [
      makeRow('a', d(0)),
      makeRow('b', d(1)),
      makeRow('c', d(2)),
      makeRow('d', d(3)),
    ]
    mockGetGroupExpenses.mockResolvedValue(rows as never)

    const result = await listAllHandler({
      input: { groupId: 'g1', limit: 3 },
    })
    expect(result.expenses).toHaveLength(3)
    expect(result.expenses.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('derives nextCursor from the LAST RETURNED row (not the lookahead row)', async () => {
    const lastReturned = makeRow(
      'c',
      new Date('2026-05-08T12:00:00.000Z'),
      new Date('2026-05-08T11:00:00.000Z'),
    )
    const lookahead = makeRow(
      'd',
      new Date('2026-05-07T12:00:00.000Z'),
      new Date('2026-05-07T11:00:00.000Z'),
    )
    const rows = [
      makeRow('a', new Date('2026-05-10T12:00:00.000Z')),
      makeRow('b', new Date('2026-05-09T12:00:00.000Z')),
      lastReturned,
      lookahead,
    ]
    mockGetGroupExpenses.mockResolvedValue(rows as never)

    const result = await listAllHandler({
      input: { groupId: 'g1', limit: 3 },
    })
    expect(result.nextCursor).toEqual({
      expenseDate: lastReturned.expenseDate.toISOString(),
      createdAt: lastReturned.createdAt.toISOString(),
      id: 'c',
    })
    // Sanity: the lookahead row's id must NOT appear in the cursor.
    expect(result.nextCursor?.id).not.toBe('d')
  })

  it('returns nextCursor=null when fewer than limit+1 rows come back', async () => {
    const rows = [
      makeRow('a', new Date('2026-05-10T12:00:00.000Z')),
      makeRow('b', new Date('2026-05-09T12:00:00.000Z')),
    ]
    mockGetGroupExpenses.mockResolvedValue(rows as never)

    const result = await listAllHandler({
      input: { groupId: 'g1', limit: 3 },
    })
    expect(result.nextCursor).toBeNull()
    expect(result.expenses).toHaveLength(2)
  })

  it('converts cursor wire ISO strings to Date when querying the API', async () => {
    mockGetGroupExpenses.mockResolvedValue([])
    const expenseDateIso = '2026-05-10T12:00:00.000Z'
    const createdAtIso = '2026-05-10T11:00:00.000Z'
    await listAllHandler({
      input: {
        groupId: 'g1',
        limit: 100,
        cursor: {
          expenseDate: expenseDateIso,
          createdAt: createdAtIso,
          id: 'exp-1',
        },
      },
    })
    expect(mockGetGroupExpenses).toHaveBeenCalledWith('g1', {
      cursor: {
        expenseDate: new Date(expenseDateIso),
        createdAt: new Date(createdAtIso),
        id: 'exp-1',
      },
      limit: 101,
    })
  })

  it('emits nextCursor with ISO string fields (wire contract)', async () => {
    const last = makeRow(
      'c',
      new Date('2026-05-08T12:00:00.000Z'),
      new Date('2026-05-08T11:00:00.000Z'),
    )
    const rows = [
      makeRow('a', new Date('2026-05-10T12:00:00.000Z')),
      last,
      makeRow('d', new Date('2026-05-07T12:00:00.000Z')),
    ]
    mockGetGroupExpenses.mockResolvedValue(rows as never)
    const result = await listAllHandler({
      input: { groupId: 'g1', limit: 2 },
    })
    expect(typeof result.nextCursor?.expenseDate).toBe('string')
    expect(typeof result.nextCursor?.createdAt).toBe('string')
    expect(result.nextCursor?.expenseDate).toBe(last.expenseDate.toISOString())
    expect(result.nextCursor?.createdAt).toBe(last.createdAt.toISOString())
  })

  it('handles same-expenseDate page boundary without skip/duplication via id tiebreaker', async () => {
    // Two rows share expenseDate AND createdAt; only the id tiebreaker
    // distinguishes them. The lookahead-aware cursor must point at the
    // LAST RETURNED row's id, never the lookahead's, so the next page
    // resumes from exactly the right row.
    const sameExpenseDate = new Date('2026-05-10T12:00:00.000Z')
    const sameCreatedAt = new Date('2026-05-10T11:00:00.000Z')
    const lastReturned = makeRow('id-b', sameExpenseDate, sameCreatedAt)
    const lookahead = makeRow('id-a', sameExpenseDate, sameCreatedAt)
    const rows = [
      makeRow(
        'id-d',
        new Date('2026-05-11T12:00:00.000Z'),
        new Date('2026-05-11T11:00:00.000Z'),
      ),
      makeRow(
        'id-c',
        new Date('2026-05-10T13:00:00.000Z'),
        new Date('2026-05-10T13:00:00.000Z'),
      ),
      lastReturned,
      lookahead,
    ]
    mockGetGroupExpenses.mockResolvedValue(rows as never)

    const result = await listAllHandler({
      input: { groupId: 'g1', limit: 3 },
    })
    expect(result.expenses.map((e) => e.id)).toEqual(['id-d', 'id-c', 'id-b'])
    expect(result.nextCursor?.id).toBe('id-b')
  })

  it('passes encrypted ciphertext through unchanged (server has no key)', async () => {
    // The procedure itself never decrypts — it returns ciphertext strings
    // for client-side decryption. This exercises the unencrypted-shape
    // pass-through too (Codex review observation 1: dual-path).
    const ciphertextRow = makeRow('e1', new Date('2026-05-10T12:00:00.000Z'))
    ciphertextRow.title = 'cipher:abcd'
    ciphertextRow.amount = 'cipher:1000'
    mockGetGroupExpenses.mockResolvedValue([ciphertextRow] as never)

    const result = await listAllHandler({
      input: { groupId: 'g1', limit: 100 },
    })
    expect(result.expenses[0].title).toBe('cipher:abcd')
    expect(result.expenses[0].amount).toBe('cipher:1000')
  })
})
