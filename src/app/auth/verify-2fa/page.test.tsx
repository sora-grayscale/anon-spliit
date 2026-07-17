/**
 * @jest-environment jsdom
 */

/**
 * Tests for the TOTP verification page.
 *
 * - Auto-submit gating (auth-gate hardening): a fetch rejection must not
 *   re-fire the same token in a loop, and a code that already reached the
 *   server is never auto-resent — recovery goes through update() first.
 * - Fragment restoration (2FA fragment loss fix): the parked URL fragment
 *   (E2EE key) is re-attached exactly once, the redirect-away effect can
 *   never steal the navigation with replace('/'), and no failure path
 *   consumes the fragment.
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
import { setPendingFragment, takePendingFragment } from '@/lib/pending-fragment'
import {
  invalidateTwoFactorFlow,
  markVerifyIdle,
  markVerifyServerVerified,
  releaseTwoFactorLease,
  tryAcquireTwoFactorLease,
} from '@/lib/two-factor-verify-flow'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { StrictMode } from 'react'

const mockedUseSession = useSession as jest.MockedFunction<typeof useSession>
const mockedUseRouter = useRouter as jest.MockedFunction<typeof useRouter>
const mockedUseSearchParams = useSearchParams as jest.MockedFunction<
  typeof useSearchParams
>

const SUBJECT = { id: 'u1', isAdmin: false }

type UpdateBehavior = 'success' | 'staleTrue' | 'foreignSubject' | 'null'

function setup2FASession(
  callbackUrl: string | null = null,
  {
    updateBehavior = 'success',
    requiresTwoFactor = true,
  }: { updateBehavior?: UpdateBehavior; requiresTwoFactor?: boolean } = {},
) {
  const replace = jest.fn()
  mockedUseRouter.mockReturnValue({ replace } as never)
  mockedUseSearchParams.mockReturnValue({
    get: (key: string) => (key === 'callbackUrl' ? callbackUrl : null),
  } as never)
  // Stateful mock mirroring production: a successful update() makes the
  // refreshed session come back with requiresTwoFactor=false, re-firing the
  // redirect-away effect (the race gated by the flow lease).
  let currentRequiresTwoFactor = requiresTwoFactor
  const update = jest.fn(() => {
    if (updateBehavior === 'null') return Promise.resolve(null)
    if (updateBehavior === 'staleTrue') {
      // Truthy session whose flag did NOT clear (e.g. the 5-minute server
      // window expired) — must not count as success.
      return Promise.resolve({
        user: { id: 'u1', isAdmin: false, requiresTwoFactor: true },
      })
    }
    if (updateBehavior === 'foreignSubject') {
      // A session for a different subject — must not count as success.
      return Promise.resolve({
        user: { id: 'u2', isAdmin: false, requiresTwoFactor: false },
      })
    }
    currentRequiresTwoFactor = false
    return Promise.resolve({
      user: { id: 'u1', isAdmin: false, requiresTwoFactor: false },
    })
  })
  mockedUseSession.mockImplementation(
    () =>
      ({
        data: {
          user: {
            id: 'u1',
            email: 'user@example.com',
            isAdmin: false,
            requiresTwoFactor: currentRequiresTwoFactor,
          },
        },
        status: 'authenticated',
        update,
      }) as never,
  )
  return { replace, update }
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
      status: 200,
      json: () => Promise.resolve({}),
    } as Response),
  )
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

function statusFetch(status: number, body: unknown = {}) {
  const fetchMock = jest.fn(() =>
    Promise.resolve({
      ok: false,
      status,
      json: () => Promise.resolve(body),
    } as Response),
  )
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

function typeToken(value: string) {
  fireEvent.change(screen.getByLabelText('verify.codeLabel'), {
    target: { value },
  })
}

function resetFlowState() {
  invalidateTwoFactorFlow()
  const lease = tryAcquireTwoFactorLease()
  markVerifyIdle(lease)
  releaseTwoFactorLease(lease)
}

beforeEach(() => {
  jest.clearAllMocks()
  resetFlowState()
  setup2FASession()
})

describe('Verify2FAPage auto-submit gating', () => {
  it('auto-submits once and does not auto-resubmit after a rejected fetch', async () => {
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
  })

  it('never auto-resends the same code once its outcome is unknown; a different code retries', async () => {
    // staleTrue: the update-first recovery does not resolve the session, so
    // the resend rules decide what happens next.
    setup2FASession(null, { updateBehavior: 'staleTrue' })
    const fetchMock = rejectingFetch()
    render(<Verify2FAPage />)

    const input = screen.getByLabelText('verify.codeLabel') as HTMLInputElement
    fireEvent.change(input, { target: { value: '123456' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(input.disabled).toBe(false))

    // Re-entering the SAME code must not re-send it (its dispatch may have
    // reached the server).
    fireEvent.change(input, { target: { value: '12345' } })
    fireEvent.change(input, { target: { value: '123456' } })
    await waitFor(() =>
      expect(screen.getByText('verify.errors.networkError')).toBeTruthy(),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // A DIFFERENT code is a fresh attempt.
    fireEvent.change(input, { target: { value: '654321' } })
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

    typeToken('123456')

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// The pending-fragment and verify-flow stores are module-level, so each test
// uses its own unique callback path (see pending-fragment.test.ts).
describe('Verify2FAPage fragment restoration', () => {
  it('re-attaches the parked fragment (E2EE key) to the callback URL after success', async () => {
    const { replace } = setup2FASession('/groups/vf')
    succeedingFetch()
    setPendingFragment('/groups/vf', 'KEYvf')

    render(<Verify2FAPage />)
    typeToken('123456')

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/groups/vf#KEYvf'),
    )
    // Wait for the post-update re-render (requiresTwoFactor=false renders
    // null) so the redirect-away effect has re-fired before asserting it did
    // not steal the navigation with replace('/').
    await waitFor(() =>
      expect(screen.queryByLabelText('verify.codeLabel')).toBeNull(),
    )
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalledWith('/')
  })

  it('navigates to the plain callback URL when no fragment is pending', async () => {
    const { replace } = setup2FASession('/groups/vf-plain')
    succeedingFetch()

    render(<Verify2FAPage />)
    typeToken('123456')

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/groups/vf-plain'),
    )
    await waitFor(() =>
      expect(screen.queryByLabelText('verify.codeLabel')).toBeNull(),
    )
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalledWith('/')
  })

  it('does not navigate or consume the fragment when update() returns null', async () => {
    const { replace } = setup2FASession('/groups/vf-upnull', {
      updateBehavior: 'null',
    })
    succeedingFetch()
    setPendingFragment('/groups/vf-upnull', 'KEYupnull')

    render(<Verify2FAPage />)
    typeToken('123456')

    await waitFor(() =>
      expect(screen.getByText('verify.errors.networkError')).toBeTruthy(),
    )
    expect(replace).not.toHaveBeenCalled()
    // The parked fragment must survive for the retry.
    expect(takePendingFragment('/groups/vf-upnull')).toBe('KEYupnull')
  })

  it('treats a truthy session with requiresTwoFactor still true as a failure', async () => {
    const { replace } = setup2FASession('/groups/vf-stale', {
      updateBehavior: 'staleTrue',
    })
    succeedingFetch()
    setPendingFragment('/groups/vf-stale', 'KEYstale')

    render(<Verify2FAPage />)
    typeToken('123456')

    await waitFor(() =>
      expect(screen.getByText('verify.errors.networkError')).toBeTruthy(),
    )
    expect(replace).not.toHaveBeenCalled()
    expect(takePendingFragment('/groups/vf-stale')).toBe('KEYstale')
  })

  it('treats a session for a different subject as a failure', async () => {
    const { replace } = setup2FASession('/groups/vf-foreign', {
      updateBehavior: 'foreignSubject',
    })
    succeedingFetch()
    setPendingFragment('/groups/vf-foreign', 'KEYforeign')

    render(<Verify2FAPage />)
    typeToken('123456')

    await waitFor(() =>
      expect(screen.getByText('verify.errors.networkError')).toBeTruthy(),
    )
    expect(replace).not.toHaveBeenCalled()
    expect(takePendingFragment('/groups/vf-foreign')).toBe('KEYforeign')
  })

  it('resets to idle on a 4xx rejection: the same code can be re-sent', async () => {
    const { replace } = setup2FASession('/groups/vf-4xx')
    const fetchMock = statusFetch(401, { error: 'Invalid token' })
    setPendingFragment('/groups/vf-4xx', 'KEY4xx')

    render(<Verify2FAPage />)
    const input = screen.getByLabelText('verify.codeLabel') as HTMLInputElement
    fireEvent.change(input, { target: { value: '123456' } })

    await waitFor(() => expect(screen.getByText('Invalid token')).toBeTruthy())
    expect(input.value).toBe('')
    expect(replace).not.toHaveBeenCalled()

    // A definite rejection resets the outcome: re-entering the same code is
    // a fresh POST, not an update-first recovery.
    fireEvent.change(input, { target: { value: '123456' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(takePendingFragment('/groups/vf-4xx')).toBe('KEY4xx')
  })

  it('recovers from a post-commit 5xx via update() without re-sending the code', async () => {
    const { replace, update } = setup2FASession('/groups/vf-5xx')
    const fetchMock = statusFetch(500, {})
    setPendingFragment('/groups/vf-5xx', 'KEY5xx')

    render(<Verify2FAPage />)
    typeToken('123456')

    await waitFor(() =>
      expect(screen.getByText('verify.errors.verificationFailed')).toBeTruthy(),
    )
    expect(replace).not.toHaveBeenCalled()

    // The server may have committed before the 5xx (rate-limit cleanup runs
    // after the DB writes): the retry syncs the session first and never
    // re-sends the consumed code.
    fireEvent.click(screen.getByRole('button', { name: 'verify.submit' }))
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/groups/vf-5xx#KEY5xx'),
    )
    expect(update).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalledWith('/')
  })

  it('recovers from a rejected fetch (commit unknown) via update() without re-sending', async () => {
    const { replace } = setup2FASession('/groups/vf-rej')
    const fetchMock = rejectingFetch()
    setPendingFragment('/groups/vf-rej', 'KEYrej')

    render(<Verify2FAPage />)
    typeToken('123456')

    await waitFor(() =>
      expect(screen.getByText('verify.errors.networkError')).toBeTruthy(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'verify.submit' }))
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/groups/vf-rej#KEYrej'),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('completes on a 2xx even when the response body fails to parse', async () => {
    const { replace, update } = setup2FASession('/groups/vf-parse')
    const fetchMock = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('bad body')),
      } as unknown as Response),
    )
    global.fetch = fetchMock as unknown as typeof fetch
    setPendingFragment('/groups/vf-parse', 'KEYparse')

    render(<Verify2FAPage />)
    typeToken('123456')

    // A 2xx means the server committed; a broken body must not discard it.
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/groups/vf-parse#KEYparse'),
    )
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('releases the lease when the token fails length validation', async () => {
    setup2FASession('/groups/vf-len')
    succeedingFetch()

    render(<Verify2FAPage />)
    typeToken('123')
    fireEvent.click(screen.getByRole('button', { name: 'verify.submit' }))

    await waitFor(() =>
      expect(screen.getByText('verify.errors.invalidLength')).toBeTruthy(),
    )
    // The aborted submit must not leave the flow lease held.
    const lease = tryAcquireTwoFactorLease()
    expect(lease).not.toBeNull()
    releaseTwoFactorLease(lease)
  })
})

describe('Verify2FAPage redirect-away behavior', () => {
  it('bounces a direct visit that does not require 2FA to / exactly once (StrictMode)', async () => {
    const { replace } = setup2FASession(null, { requiresTwoFactor: false })

    render(
      <StrictMode>
        <Verify2FAPage />
      </StrictMode>,
    )

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
    expect(replace).toHaveBeenCalledTimes(1)
  })

  it('completes a recovered verification with the callback + fragment instead of bouncing to /', async () => {
    // A prior transaction reached the server and the session has since
    // flipped (e.g. it was interrupted after update()): the outcome for this
    // subject must finish the navigation, not discard the parked key.
    const lease = tryAcquireTwoFactorLease()
    markVerifyServerVerified(lease, SUBJECT)
    releaseTwoFactorLease(lease)
    setPendingFragment('/groups/vf-rc', 'KEYrc')
    const { replace } = setup2FASession('/groups/vf-rc', {
      requiresTwoFactor: false,
    })

    render(<Verify2FAPage />)

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/groups/vf-rc#KEYrc'),
    )
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalledWith('/')
  })

  it('normalizes a callback pointing back into the verify flow to /', async () => {
    const { replace } = setup2FASession('/auth/verify-2fa')
    succeedingFetch()

    render(<Verify2FAPage />)
    typeToken('123456')

    // Landing back inside the flow would keep the lease active forever and
    // strand the user on a blank page.
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
    expect(replace).toHaveBeenCalledTimes(1)
  })
})
