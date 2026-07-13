/**
 * @jest-environment jsdom
 */

jest.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => {
    const t = (key: string) => key
    ;(t as unknown as { rich: (key: string) => string }).rich = (key: string) =>
      key
    return t
  },
}))
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}))

import { Reimbursement } from '@/lib/balances'
import { Currency } from '@/lib/currency'
import { getReimbursementAmount } from '@/lib/reimbursement-prefill'
import { Participant } from '@prisma/client'
import { fireEvent, render } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import { ReimbursementList } from './reimbursement-list'

const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>

const currency: Currency = {
  name: 'US Dollar',
  symbol_native: '$',
  symbol: '$',
  code: 'USD',
  name_plural: 'US dollars',
  rounding: 0,
  decimal_digits: 2,
}

const participants: Participant[] = [
  { id: 'p1', name: 'Alice', groupId: 'g1' },
  { id: 'p2', name: 'Bob', groupId: 'g1' },
]

let routerPushMock: jest.Mock

beforeEach(() => {
  routerPushMock = jest.fn()
  mockUseRouter.mockReset()
  mockUseRouter.mockReturnValue({ push: routerPushMock } as never)
})

describe('ReimbursementList (Issue #240 security invariant)', () => {
  it('hands the amount off in memory and keeps it out of the URL', () => {
    const reimbursement: Reimbursement = { from: 'p1', to: 'p2', amount: 4200 }

    const { getByText } = render(
      <ReimbursementList
        reimbursements={[reimbursement]}
        participants={participants}
        currency={currency}
        groupId="g1"
      />,
    )

    // fireEvent wraps the click in act(), flushing the state/navigation work.
    fireEvent.click(getByText('markAsPaid'))

    // (a) The navigation carries only the pseudonymous ids, never the amount.
    expect(routerPushMock).toHaveBeenCalledTimes(1)
    const url = routerPushMock.mock.calls[0][0] as string
    expect(url).toContain('reimbursement=')
    expect(url).toContain('from=p1')
    expect(url).toContain('to=p2')
    expect(url).not.toContain('amount=')

    // (b) The plaintext amount travels through the in-memory store instead
    // (real store, not mocked).
    expect(getReimbursementAmount('g1', 'p1', 'p2')).toBe(4200)
  })
})
