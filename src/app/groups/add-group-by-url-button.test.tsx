/**
 * @jest-environment jsdom
 */

jest.mock('@/app/groups/recent-groups-helpers', () => ({
  saveRecentGroup: jest.fn(),
}))
jest.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}))
jest.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}))
jest.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))
jest.mock('@/lib/hooks', () => ({
  useMediaQuery: jest.fn(() => false),
}))
jest.mock('@/trpc/client', () => {
  const fetchMock = jest.fn()
  return {
    trpc: {
      useUtils: () => ({
        groups: {
          get: {
            fetch: fetchMock,
          },
        },
      }),
    },
    __mockFetchGroup: fetchMock,
  }
})
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { fireEvent, render, waitFor } from '@testing-library/react'
import { AddGroupByUrlButton } from './add-group-by-url-button'

const trpcMocks = jest.requireMock('@/trpc/client') as {
  __mockFetchGroup: jest.Mock
}

beforeEach(() => {
  trpcMocks.__mockFetchGroup.mockReset()
})

describe('AddGroupByUrlButton', () => {
  it('rejects invalid group URLs without leaving the button pending (Issue #190)', async () => {
    const reload = jest.fn()
    const { getByPlaceholderText, getByText, getAllByRole } = render(
      <AddGroupByUrlButton reload={reload} />,
    )

    const input = getByPlaceholderText('https://spliit.app/...')
    fireEvent.change(input, {
      target: { value: 'https://example.com/groups/not-this-origin' },
    })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => expect(getByText('error')).toBeTruthy())
    expect(trpcMocks.__mockFetchGroup).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect((getAllByRole('button')[1] as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('resets pending state when the fetch throws (Issue #190)', async () => {
    trpcMocks.__mockFetchGroup.mockRejectedValue(new Error('network'))
    const reload = jest.fn()
    const { getByPlaceholderText, getByText, getAllByRole } = render(
      <AddGroupByUrlButton reload={reload} />,
    )

    const input = getByPlaceholderText('https://spliit.app/...')
    fireEvent.change(input, {
      target: { value: `${window.location.origin}/groups/group-1` },
    })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => expect(getByText('error')).toBeTruthy())
    expect(reload).not.toHaveBeenCalled()
    expect((getAllByRole('button')[1] as HTMLButtonElement).disabled).toBe(
      false,
    )
  })
})
