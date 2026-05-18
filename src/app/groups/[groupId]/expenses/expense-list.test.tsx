/**
 * @jest-environment jsdom
 */

jest.mock('@/app/groups/[groupId]/expenses/expense-card', () => ({
  ExpenseCard: ({ expense }: { expense: { id: string; title: string } }) => (
    <div data-testid={`expense-${expense.id}`}>{expense.title}</div>
  ),
}))
jest.mock('@/components/encryption-provider', () => ({
  useEncryption: jest.fn(),
}))
jest.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
}))
jest.mock('@/components/ui/search-bar', () => ({
  SearchBar: () => <input data-testid="search-bar" />,
}))
jest.mock('@/components/ui/skeleton', () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}))
jest.mock('@/lib/encrypt-helpers', () => ({
  decryptExpenses: jest.fn(),
}))
jest.mock('@/lib/storage', () => ({
  safeGetItem: jest.fn(() => null),
  safeRemoveItem: jest.fn(),
  safeSetItem: jest.fn(),
}))
jest.mock('@/lib/utils', () => ({
  getCurrencyFromGroup: jest.fn(() => ({ code: 'USD', symbol: '$' })),
}))
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
jest.mock('react-intersection-observer', () => ({
  useInView: () => ({ ref: jest.fn(), inView: false }),
}))
jest.mock('use-debounce', () => ({
  useDebounce: (v: unknown) => [v],
}))
jest.mock('../current-group-context', () => ({
  useCurrentGroup: jest.fn(),
}))
// Regression for Issue #172: the previous version called `trpc.useUtils()`
// and fired `utils.groups.expenses.invalidate()` in a mount-time useEffect.
// After the fix the component must NOT touch useUtils at all.
jest.mock('@/trpc/client', () => {
  const useInfiniteQueryMock = jest.fn()
  const useUtilsMock = jest.fn(() => ({
    groups: { expenses: { invalidate: jest.fn() } },
  }))
  return {
    trpc: {
      useUtils: useUtilsMock,
      groups: {
        expenses: {
          list: {
            useInfiniteQuery: (...args: unknown[]) =>
              useInfiniteQueryMock(...args),
          },
        },
      },
    },
    __mockUseInfiniteQuery: useInfiniteQueryMock,
    __mockUseUtils: useUtilsMock,
  }
})

import { useEncryption } from '@/components/encryption-provider'
import { decryptExpenses } from '@/lib/encrypt-helpers'
import { act, render, waitFor } from '@testing-library/react'
import { useCurrentGroup } from '../current-group-context'
import { ExpenseList } from './expense-list'

const mockUseEncryption = useEncryption as jest.MockedFunction<
  typeof useEncryption
>
const mockDecryptExpenses = decryptExpenses as jest.MockedFunction<
  typeof decryptExpenses
>
const mockUseCurrentGroup = useCurrentGroup as jest.MockedFunction<
  typeof useCurrentGroup
>
const trpcMocks = jest.requireMock('@/trpc/client') as {
  __mockUseInfiniteQuery: jest.Mock
  __mockUseUtils: jest.Mock
}

const FAKE_KEY = new Uint8Array([1, 2, 3])

function fakeExpense(id: string, title: string) {
  return {
    id,
    title,
    amount: '100',
    paidBy: { id: 'p1', name: 'Alice' },
    paidFor: [],
    categoryId: '0',
    expenseDate: new Date('2026-05-10T00:00:00.000Z'),
    createdAt: new Date('2026-05-10T00:00:00.000Z'),
    splitMode: 'EVENLY' as const,
    isReimbursement: false,
    notes: null,
    originalAmount: null,
    originalCurrency: null,
    conversionRate: null,
    recurrenceRule: null,
    recurringExpenseLinkId: null,
    groupId: 'g1',
    paidById: 'p1',
  }
}

function infiniteQueryReturn(expenses: ReturnType<typeof fakeExpense>[]) {
  return {
    data: {
      pages: [{ expenses, nextCursor: null, hasMore: false }],
    },
    isLoading: false,
    fetchNextPage: jest.fn(),
  }
}

// React 19 + jsdom emits "update not wrapped in act" warnings for the
// useEffect async-decrypt setState inside ExpenseListForSearch. Functionally
// the state is observed (waitFor / act guards the assertions), so we suppress
// this specific warning to keep test output clean. Other console.error
// messages pass through.
let consoleErrorSpy: jest.SpyInstance

beforeEach(() => {
  const originalError = console.error
  consoleErrorSpy = jest
    .spyOn(console, 'error')
    .mockImplementation((msg: unknown, ...rest: unknown[]) => {
      if (typeof msg === 'string' && msg.includes('was not wrapped in act')) {
        return
      }
      originalError(msg, ...rest)
    })

  trpcMocks.__mockUseInfiniteQuery.mockReset()
  trpcMocks.__mockUseUtils.mockClear()

  mockUseEncryption.mockReset()
  mockUseEncryption.mockReturnValue({
    encryptionKey: FAKE_KEY,
    isLoading: false,
    hasKey: true,
  } as never)
  mockDecryptExpenses.mockReset()
  mockDecryptExpenses.mockImplementation(async (xs) => xs as never)
  mockUseCurrentGroup.mockReset()
  mockUseCurrentGroup.mockReturnValue({
    groupId: 'g1',
    group: {
      id: 'g1',
      participants: [{ id: 'p1', name: 'Alice' }],
      currency: 'USD',
    },
  } as never)
})

afterEach(() => {
  consoleErrorSpy?.mockRestore()
})

describe('ExpenseList', () => {
  it('does not call trpc.useUtils() on mount (Issue #172 regression)', () => {
    trpcMocks.__mockUseInfiniteQuery.mockReturnValue(infiniteQueryReturn([]))
    render(<ExpenseList />)
    expect(trpcMocks.__mockUseUtils).not.toHaveBeenCalled()
  })

  it('re-decrypts when rawExpenses reference changes (Issue #171 regression)', async () => {
    const pageA = [fakeExpense('a', 'cipher:A')]
    const pageB = [fakeExpense('a', 'cipher:A2')] // same id, new reference

    trpcMocks.__mockUseInfiniteQuery.mockReturnValue(infiniteQueryReturn(pageA))
    const { rerender } = render(<ExpenseList />)

    await waitFor(() => expect(mockDecryptExpenses).toHaveBeenCalledTimes(1))
    expect(mockDecryptExpenses).toHaveBeenLastCalledWith(pageA, FAKE_KEY)
    // Flush the async setState from the first decrypt so React 19 doesn't
    // emit an "update not wrapped in act" warning when we proceed to rerender.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    trpcMocks.__mockUseInfiniteQuery.mockReturnValue(infiniteQueryReturn(pageB))
    rerender(<ExpenseList />)

    await waitFor(() => expect(mockDecryptExpenses).toHaveBeenCalledTimes(2))
    expect(mockDecryptExpenses).toHaveBeenLastCalledWith(pageB, FAKE_KEY)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  })

  it('skips decryption when the group is unencrypted (hasKey=false)', async () => {
    mockUseEncryption.mockReturnValue({
      encryptionKey: null,
      isLoading: false,
      hasKey: false,
    } as never)
    trpcMocks.__mockUseInfiniteQuery.mockReturnValue(
      infiniteQueryReturn([fakeExpense('a', 'plain')]),
    )

    render(<ExpenseList />)

    // Wait long enough for any erroneous decrypt to land. Wrapped in act so
    // React 19 doesn't warn about state updates outside of act.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(mockDecryptExpenses).not.toHaveBeenCalled()
  })
})
