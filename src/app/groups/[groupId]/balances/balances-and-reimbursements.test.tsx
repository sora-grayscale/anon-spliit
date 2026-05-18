/**
 * @jest-environment jsdom
 */

jest.mock('@/lib/hooks/useBalances', () => ({
  useBalances: jest.fn(),
}))
jest.mock('../current-group-context', () => ({
  useCurrentGroup: jest.fn(),
}))
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
// Heavy children: replace with stubs so the test focuses on the parent.
jest.mock('@/app/groups/[groupId]/balances-list', () => ({
  BalancesList: () => <div data-testid="balances-list" />,
}))
jest.mock('@/app/groups/[groupId]/reimbursement-list', () => ({
  ReimbursementList: () => <div data-testid="reimbursement-list" />,
}))
// Regression for Issue #172: the previous version called `trpc.useUtils()` and
// fired `utils.groups.expenses.invalidate()` in a mount-time useEffect. After
// the fix the component must not touch tRPC at all — the mock spy must stay
// untouched throughout render.
jest.mock('@/trpc/client', () => {
  const useUtilsMock = jest.fn(() => ({
    groups: { expenses: { invalidate: jest.fn() } },
  }))
  return {
    trpc: { useUtils: useUtilsMock },
    __mockUseUtils: useUtilsMock,
  }
})

import { useBalances } from '@/lib/hooks/useBalances'
import { render } from '@testing-library/react'
import { useCurrentGroup } from '../current-group-context'
import BalancesAndReimbursements from './balances-and-reimbursements'

const mockUseBalances = useBalances as jest.MockedFunction<typeof useBalances>
const mockUseCurrentGroup = useCurrentGroup as jest.MockedFunction<
  typeof useCurrentGroup
>
const mockUseUtils = (
  jest.requireMock('@/trpc/client') as { __mockUseUtils: jest.Mock }
).__mockUseUtils

beforeEach(() => {
  mockUseUtils.mockClear()
  mockUseBalances.mockReset()
  mockUseBalances.mockReturnValue({
    balances: {},
    reimbursements: [],
    isLoading: false,
    expenses: [],
    queryError: null,
    decryptionError: null,
  } as never)
  mockUseCurrentGroup.mockReset()
  mockUseCurrentGroup.mockReturnValue({
    groupId: 'g1',
    group: {
      id: 'g1',
      participants: [
        { id: 'p1', name: 'Alice' },
        { id: 'p2', name: 'Bob' },
      ],
      currency: '$',
    },
  } as never)
})

describe('BalancesAndReimbursements', () => {
  it('does not call trpc.useUtils() on mount (Issue #172 regression)', () => {
    render(<BalancesAndReimbursements />)
    expect(mockUseUtils).not.toHaveBeenCalled()
  })

  it('renders the balances/reimbursements lists when data is available', () => {
    const { getByTestId } = render(<BalancesAndReimbursements />)
    expect(getByTestId('balances-list')).toBeTruthy()
    expect(getByTestId('reimbursement-list')).toBeTruthy()
  })
})
