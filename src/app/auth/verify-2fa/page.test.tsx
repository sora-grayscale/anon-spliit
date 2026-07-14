/**
 * @jest-environment jsdom
 */

/**
 * Auto-submit loop regression test for the 2FA verification page (auth-gate
 * hardening).
 *
 * A fetch rejection (offline) previously left the token intact while
 * `isLoading` flipped back to false, which re-triggered the auto-submit
 * effect in an infinite loop. A ref records the last attempted token so the
 * effect only fires for a not-yet-attempted token; manual submit bypasses
 * the gate; editing the token re-enables auto-submit.
 */

jest.mock('next-auth/react', () => ({
  useSession: jest.fn(),
}))

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>,
}))

import Verify2FAPage from '@/app/auth/verify-2fa/page'
import { setPendingFragment } from '@/lib/pending-fragment'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { StrictMode } from 'react'

const mockedUseSession = useSession as jest.MockedFunction<typeof useSession>
const mockedUseRouter = useRouter as jest.MockedFunction<typeof useRouter>
const mockedUseSearchParams = useSearchParams as jest.MockedFunction<
  typeof useSearchParams
>

function setup2FASession(callbackUrl: string | null = null) {
  const replace = jest.fn()
  mockedUseRouter.mockReturnValue({ replace } as never)
  mockedUseSearchParams.mockReturnValue({
    get: (key: string) => (key === 'callbackUrl' ? callbackUrl : null),
  } as never)
  mockedUseSession.mockReturnValue({
    data: {
      user: { email: 'user@example.com', requiresTwoFactor: true },
    },
    status: 'authenticated',
    update: jest.fn(() => Promise.resolve()),
  } as never)
  return replace
}

function rejectingFetch() {
  const fetchMock = jest.fn(() => Promise.reject(new Error('offline')))
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

function succeedingFetch() {
  const fetchMock = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response),
  )
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

beforeEach(() => {
  jest.clearAllMocks()
  setup2FASession()
})

describe('Verify2FAPage auto-submit gating', () => {
  it('auto-submits once, does not resubmit after a rejected fetch, then a manual click submits once more', async () => {
    const fetchMock = rejectingFetch()
    render(<Verify2FAPage />)

    const input = screen.getByLabelText('verify.codeLabel') as HTMLInputElement
    fireEvent.change(input, { target: { value: '123456' } })

    // Auto-submit fires exactly once.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    // After the rejection, the input is retained and the button re-enables,
    // but the effect does NOT auto-resubmit the same token.
    const button = screen.getByRole('button', {
      name: 'verify.submit',
    }) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(false))
    expect(input.value).toBe('123456')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // A manual click submits exactly once more.
    fireEvent.click(button)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('re-enables auto-submit after the user re-enters the same 6 digits', async () => {
    const fetchMock = rejectingFetch()
    render(<Verify2FAPage />)

    const input = screen.getByLabelText('verify.codeLabel') as HTMLInputElement
    fireEvent.change(input, { target: { value: '123456' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(input.disabled).toBe(false))

    // Editing clears the ref; re-entering the same code retries.
    fireEvent.change(input, { target: { value: '12345' } })
    fireEvent.change(input, { target: { value: '123456' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('does not double-submit under StrictMode', async () => {
    // A never-settling fetch keeps isLoading true so any StrictMode effect
    // double-invoke would show up as a second call.
    const fetchMock = jest.fn(() => new Promise<Response>(() => {}))
    global.fetch = fetchMock as unknown as typeof fetch

    render(
      <StrictMode>
        <Verify2FAPage />
      </StrictMode>,
    )

    const input = screen.getByLabelText('verify.codeLabel') as HTMLInputElement
    fireEvent.change(input, { target: { value: '123456' } })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// The pending-fragment store is module-level, so each test uses its own
// unique callback path (see pending-fragment.test.ts for the convention).
describe('Verify2FAPage fragment restoration', () => {
  it('re-attaches the parked fragment (E2EE key) to the callback URL after success', async () => {
    const replace = setup2FASession('/groups/vf')
    succeedingFetch()
    setPendingFragment('/groups/vf', 'KEYvf')

    render(<Verify2FAPage />)
    fireEvent.change(screen.getByLabelText('verify.codeLabel'), {
      target: { value: '123456' },
    })

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/groups/vf#KEYvf'),
    )
  })

  it('navigates to the plain callback URL when no fragment is pending', async () => {
    const replace = setup2FASession('/groups/vf-plain')
    succeedingFetch()

    render(<Verify2FAPage />)
    fireEvent.change(screen.getByLabelText('verify.codeLabel'), {
      target: { value: '123456' },
    })

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/groups/vf-plain'),
    )
  })
})
