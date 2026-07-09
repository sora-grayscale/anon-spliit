/**
 * @jest-environment jsdom
 */

jest.mock('@/components/encryption-provider', () => ({
  useEncryption: jest.fn(),
}))
jest.mock('@/components/encryption-required', () => ({
  EncryptionRequired: ({ groupId }: { groupId: string }) => (
    <div data-testid="encryption-required">{groupId}</div>
  ),
}))
jest.mock('@/lib/encrypt-helpers', () => ({
  decryptExpense: jest.fn(),
  encryptExpenseFormValues: jest.fn(),
}))
jest.mock('@/lib/hooks/aggregateCache', () => ({
  invalidateAggregate: jest.fn(),
}))
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}))
jest.mock('../current-group-context', () => ({
  useCurrentGroup: jest.fn(),
}))
// Replace the complex ExpenseForm with a stub exposing submit/delete buttons
// so we can drive the parent's onSubmit / onDelete handlers directly.
jest.mock('./expense-form', () => ({
  __esModule: true,
  ExpenseForm: ({
    onSubmit,
    onDelete,
  }: {
    onSubmit: (v: unknown, p: unknown) => Promise<void>
    onDelete: (p: unknown) => Promise<void>
  }) => (
    <div>
      <button onClick={() => void onSubmit({ formValue: true }, 'p1')}>
        submit
      </button>
      <button onClick={() => void onDelete('p1')}>delete</button>
    </div>
  ),
}))
// The real `trpc.useUtils()` returns a stable reference across renders. The
// mock mirrors that so the component does not see a fresh `utils` object on
// every render (see feedback-hook-test-patterns memo).
jest.mock('@/trpc/client', () => {
  const invalidateMock = jest.fn()
  const updateMock = jest.fn()
  const deleteMock = jest.fn()
  const categoriesQueryMock = jest.fn()
  const expenseQueryMock = jest.fn()
  const utils = {
    groups: { expenses: { invalidate: invalidateMock } },
  }
  return {
    trpc: {
      useUtils: () => utils,
      categories: {
        list: {
          useQuery: (...args: unknown[]) => categoriesQueryMock(...args),
        },
      },
      groups: {
        expenses: {
          get: {
            useQuery: (...args: unknown[]) => expenseQueryMock(...args),
          },
          update: { useMutation: () => ({ mutateAsync: updateMock }) },
          delete: { useMutation: () => ({ mutateAsync: deleteMock }) },
        },
      },
    },
    __mockInvalidate: invalidateMock,
    __mockUpdate: updateMock,
    __mockDelete: deleteMock,
    __mockCategoriesQuery: categoriesQueryMock,
    __mockExpenseQuery: expenseQueryMock,
  }
})

import { useEncryption } from '@/components/encryption-provider'
import { decryptExpense, encryptExpenseFormValues } from '@/lib/encrypt-helpers'
import { invalidateAggregate } from '@/lib/hooks/aggregateCache'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import { useCurrentGroup } from '../current-group-context'
import { EditExpenseForm } from './edit-expense-form'

const mockUseEncryption = useEncryption as jest.MockedFunction<
  typeof useEncryption
>
const mockDecryptExpense = decryptExpense as jest.MockedFunction<
  typeof decryptExpense
>
const mockEncryptExpenseFormValues =
  encryptExpenseFormValues as jest.MockedFunction<
    typeof encryptExpenseFormValues
  >
const mockInvalidateAggregate = invalidateAggregate as jest.MockedFunction<
  typeof invalidateAggregate
>
const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>
const mockUseCurrentGroup = useCurrentGroup as jest.MockedFunction<
  typeof useCurrentGroup
>

const trpcMocks = jest.requireMock('@/trpc/client') as {
  __mockInvalidate: jest.Mock
  __mockUpdate: jest.Mock
  __mockDelete: jest.Mock
  __mockCategoriesQuery: jest.Mock
  __mockExpenseQuery: jest.Mock
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

let routerPushMock: jest.Mock

beforeEach(() => {
  trpcMocks.__mockInvalidate.mockReset()
  trpcMocks.__mockInvalidate.mockResolvedValue(undefined)
  trpcMocks.__mockUpdate.mockReset()
  trpcMocks.__mockUpdate.mockResolvedValue(undefined)
  trpcMocks.__mockDelete.mockReset()
  trpcMocks.__mockDelete.mockResolvedValue(undefined)
  trpcMocks.__mockCategoriesQuery.mockReset()
  trpcMocks.__mockCategoriesQuery.mockReturnValue({
    data: { categories: [{ id: 0, grouping: 'g', name: 'cat' }] },
  })
  trpcMocks.__mockExpenseQuery.mockReset()
  mockInvalidateAggregate.mockReset()

  mockUseEncryption.mockReset()
  mockUseEncryption.mockReturnValue({
    encryptionKey: FAKE_KEY,
    isLoading: false,
    hasKey: true,
  } as never)
  mockDecryptExpense.mockReset()
  mockDecryptExpense.mockImplementation(async (e) => e as never)
  mockEncryptExpenseFormValues.mockReset()
  mockEncryptExpenseFormValues.mockImplementation(async (v) => v as never)

  routerPushMock = jest.fn()
  mockUseRouter.mockReset()
  mockUseRouter.mockReturnValue({ push: routerPushMock } as never)
  mockUseCurrentGroup.mockReset()
  mockUseCurrentGroup.mockReturnValue({
    groupId: 'g1',
    group: {
      id: 'g1',
      participants: [{ id: 'p1', name: 'Alice' }],
      currency: '$',
    },
  } as never)
})

describe('EditExpenseForm', () => {
  it('re-decrypts when the expense reference changes for the same id (Issue #171)', async () => {
    const first = fakeExpense('exp1', 'cipher:v1')
    // Same id, new object reference (simulates a refetch after a cross-tab edit).
    const second = fakeExpense('exp1', 'cipher:v2')
    trpcMocks.__mockExpenseQuery.mockReturnValue({ data: { expense: first } })

    const { rerender } = render(
      <EditExpenseForm groupId="g1" expenseId="exp1" />,
    )

    await waitFor(() =>
      expect(mockDecryptExpense).toHaveBeenCalledWith(first, FAKE_KEY),
    )
    expect(mockDecryptExpense).toHaveBeenCalledTimes(1)

    trpcMocks.__mockExpenseQuery.mockReturnValue({ data: { expense: second } })
    rerender(<EditExpenseForm groupId="g1" expenseId="exp1" />)

    await waitFor(() => expect(mockDecryptExpense).toHaveBeenCalledTimes(2))
    expect(mockDecryptExpense).toHaveBeenLastCalledWith(second, FAKE_KEY)
  })

  it('does NOT re-decrypt when the expense object reference is stable', async () => {
    const stable = fakeExpense('exp1', 'cipher:v1')
    trpcMocks.__mockExpenseQuery.mockReturnValue({ data: { expense: stable } })

    const { rerender } = render(
      <EditExpenseForm groupId="g1" expenseId="exp1" />,
    )

    await waitFor(() => expect(mockDecryptExpense).toHaveBeenCalledTimes(1))

    rerender(<EditExpenseForm groupId="g1" expenseId="exp1" />)
    rerender(<EditExpenseForm groupId="g1" expenseId="exp1" />)

    // Same reference => dep array does not re-fire => no extra decrypt.
    expect(mockDecryptExpense).toHaveBeenCalledTimes(1)
  })

  it('skips decryption entirely when the group is unencrypted (hasKey=false)', async () => {
    mockUseEncryption.mockReturnValue({
      encryptionKey: null,
      isLoading: false,
      hasKey: false,
    } as never)
    trpcMocks.__mockExpenseQuery.mockReturnValue({
      data: { expense: fakeExpense('exp1', 'plain') },
    })

    render(<EditExpenseForm groupId="g1" expenseId="exp1" />)

    // Wait long enough for any erroneous decrypt to land.
    await new Promise((r) => setTimeout(r, 20))
    expect(mockDecryptExpense).not.toHaveBeenCalled()
  })

  it('does not render ciphertext when expense decryption fails (Issue #205)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    mockDecryptExpense.mockRejectedValue(new Error('wrong key'))
    trpcMocks.__mockExpenseQuery.mockReturnValue({
      data: { expense: fakeExpense('exp1', 'ciphertext-title') },
    })

    try {
      const { getByTestId, queryByText } = render(
        <EditExpenseForm groupId="g1" expenseId="exp1" />,
      )

      await waitFor(() =>
        expect(getByTestId('encryption-required').textContent).toBe('g1'),
      )
      expect(queryByText('submit')).toBeNull()
      expect(queryByText('ciphertext-title')).toBeNull()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('awaits invalidate before navigating on update (Issue #172 finding)', async () => {
    trpcMocks.__mockExpenseQuery.mockReturnValue({
      data: { expense: fakeExpense('exp1', 'cipher') },
    })

    let resolveInvalidate: () => void = () => {}
    trpcMocks.__mockInvalidate.mockImplementation(
      () => new Promise<void>((r) => (resolveInvalidate = r)),
    )

    const { getByText } = render(
      <EditExpenseForm groupId="g1" expenseId="exp1" />,
    )

    await waitFor(() => getByText('submit'))
    fireEvent.click(getByText('submit'))

    await waitFor(() =>
      expect(trpcMocks.__mockInvalidate).toHaveBeenCalledTimes(1),
    )
    // push must NOT happen while invalidate is still pending.
    expect(routerPushMock).not.toHaveBeenCalled()

    resolveInvalidate()
    await waitFor(() =>
      expect(routerPushMock).toHaveBeenCalledWith('/groups/g1'),
    )
  })

  it('navigates anyway when invalidate rejects (finally branch)', async () => {
    trpcMocks.__mockExpenseQuery.mockReturnValue({
      data: { expense: fakeExpense('exp1', 'cipher') },
    })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    trpcMocks.__mockInvalidate.mockRejectedValue(new Error('invalidate boom'))

    const { getByText } = render(
      <EditExpenseForm groupId="g1" expenseId="exp1" />,
    )

    await waitFor(() => getByText('submit'))
    fireEvent.click(getByText('submit'))

    await waitFor(() =>
      expect(routerPushMock).toHaveBeenCalledWith('/groups/g1'),
    )
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to invalidate expenses cache:',
      expect.any(Error),
    )
    warnSpy.mockRestore()
  })

  it('awaits invalidate before navigating on delete', async () => {
    trpcMocks.__mockExpenseQuery.mockReturnValue({
      data: { expense: fakeExpense('exp1', 'cipher') },
    })
    let resolveInvalidate: () => void = () => {}
    trpcMocks.__mockInvalidate.mockImplementation(
      () => new Promise<void>((r) => (resolveInvalidate = r)),
    )

    const { getByText } = render(
      <EditExpenseForm groupId="g1" expenseId="exp1" />,
    )

    await waitFor(() => getByText('delete'))
    fireEvent.click(getByText('delete'))

    await waitFor(() => expect(trpcMocks.__mockDelete).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(trpcMocks.__mockInvalidate).toHaveBeenCalledTimes(1),
    )
    expect(routerPushMock).not.toHaveBeenCalled()

    resolveInvalidate()
    await waitFor(() =>
      expect(routerPushMock).toHaveBeenCalledWith('/groups/g1'),
    )
  })

  it('calls invalidateAggregate before awaiting utils.invalidate on update (Issue #225)', async () => {
    trpcMocks.__mockExpenseQuery.mockReturnValue({
      data: { expense: fakeExpense('exp1', 'cipher') },
    })
    let resolveInvalidate: () => void = () => {}
    trpcMocks.__mockInvalidate.mockImplementation(
      () => new Promise<void>((r) => (resolveInvalidate = r)),
    )

    const { getByText } = render(
      <EditExpenseForm groupId="g1" expenseId="exp1" />,
    )
    await waitFor(() => getByText('submit'))
    fireEvent.click(getByText('submit'))

    await waitFor(() =>
      expect(mockInvalidateAggregate).toHaveBeenCalledWith('g1'),
    )
    const aggrOrder = mockInvalidateAggregate.mock.invocationCallOrder[0]
    const utilOrder = trpcMocks.__mockInvalidate.mock.invocationCallOrder[0]
    expect(aggrOrder).toBeLessThan(utilOrder)

    resolveInvalidate()
  })

  it('calls invalidateAggregate before awaiting utils.invalidate on delete (Issue #225)', async () => {
    trpcMocks.__mockExpenseQuery.mockReturnValue({
      data: { expense: fakeExpense('exp1', 'cipher') },
    })
    let resolveInvalidate: () => void = () => {}
    trpcMocks.__mockInvalidate.mockImplementation(
      () => new Promise<void>((r) => (resolveInvalidate = r)),
    )

    const { getByText } = render(
      <EditExpenseForm groupId="g1" expenseId="exp1" />,
    )
    await waitFor(() => getByText('delete'))
    fireEvent.click(getByText('delete'))

    await waitFor(() =>
      expect(mockInvalidateAggregate).toHaveBeenCalledWith('g1'),
    )
    const aggrOrder = mockInvalidateAggregate.mock.invocationCallOrder[0]
    const utilOrder = trpcMocks.__mockInvalidate.mock.invocationCallOrder[0]
    expect(aggrOrder).toBeLessThan(utilOrder)

    resolveInvalidate()
  })
})
