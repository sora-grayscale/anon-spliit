/**
 * @jest-environment jsdom
 */

jest.mock('@/components/encryption-provider', () => ({
  useEncryption: jest.fn(),
}))
jest.mock('@/lib/encrypt-helpers', () => ({
  encryptExpenseFormValues: jest.fn(),
}))
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}))
jest.mock('../current-group-context', () => ({
  useCurrentGroup: jest.fn(),
}))
jest.mock('./expense-form', () => ({
  __esModule: true,
  ExpenseForm: ({
    onSubmit,
  }: {
    onSubmit: (v: unknown, p: unknown) => Promise<void>
  }) => (
    <button onClick={() => void onSubmit({ formValue: true }, 'p1')}>
      submit
    </button>
  ),
}))
jest.mock('@/trpc/client', () => {
  const invalidateMock = jest.fn()
  const createMock = jest.fn()
  const categoriesQueryMock = jest.fn()
  const utils = { groups: { expenses: { invalidate: invalidateMock } } }
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
          create: { useMutation: () => ({ mutateAsync: createMock }) },
        },
      },
    },
    __mockInvalidate: invalidateMock,
    __mockCreate: createMock,
    __mockCategoriesQuery: categoriesQueryMock,
  }
})

import { useEncryption } from '@/components/encryption-provider'
import { encryptExpenseFormValues } from '@/lib/encrypt-helpers'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import { useCurrentGroup } from '../current-group-context'
import { CreateExpenseForm } from './create-expense-form'

const mockUseEncryption = useEncryption as jest.MockedFunction<
  typeof useEncryption
>
const mockEncryptExpenseFormValues =
  encryptExpenseFormValues as jest.MockedFunction<
    typeof encryptExpenseFormValues
  >
const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>
const mockUseCurrentGroup = useCurrentGroup as jest.MockedFunction<
  typeof useCurrentGroup
>

const trpcMocks = jest.requireMock('@/trpc/client') as {
  __mockInvalidate: jest.Mock
  __mockCreate: jest.Mock
  __mockCategoriesQuery: jest.Mock
}

let routerPushMock: jest.Mock

beforeEach(() => {
  trpcMocks.__mockInvalidate.mockReset()
  trpcMocks.__mockInvalidate.mockResolvedValue(undefined)
  trpcMocks.__mockCreate.mockReset()
  trpcMocks.__mockCreate.mockResolvedValue(undefined)
  trpcMocks.__mockCategoriesQuery.mockReset()
  trpcMocks.__mockCategoriesQuery.mockReturnValue({
    data: { categories: [{ id: 0, grouping: 'g', name: 'cat' }] },
  })

  mockUseEncryption.mockReset()
  mockUseEncryption.mockReturnValue({
    encryptionKey: new Uint8Array([1, 2, 3]),
    isLoading: false,
    hasKey: true,
  } as never)
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

describe('CreateExpenseForm', () => {
  it('awaits invalidate before navigating on submit (Issue #172 finding)', async () => {
    let resolveInvalidate: () => void = () => {}
    trpcMocks.__mockInvalidate.mockImplementation(
      () => new Promise<void>((r) => (resolveInvalidate = r)),
    )

    const { getByText } = render(<CreateExpenseForm groupId="g1" />)

    await waitFor(() => getByText('submit'))
    fireEvent.click(getByText('submit'))

    await waitFor(() => expect(trpcMocks.__mockCreate).toHaveBeenCalledTimes(1))
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
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    trpcMocks.__mockInvalidate.mockRejectedValue(new Error('invalidate boom'))

    const { getByText } = render(<CreateExpenseForm groupId="g1" />)

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
})
