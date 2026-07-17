/**
 * @jest-environment jsdom
 */

/**
 * Tests for the backup-code verification page: fragment restoration, the
 * lease-gated redirect-away effect, and the update-first recovery path —
 * mirroring the TOTP page. Recovery matters most here: a backup code is
 * consumed server-side before the response, so it must never be re-sent
 * once its outcome is unknown or committed.
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

import BackupCodePage from '@/app/auth/verify-2fa/backup/page'
import { setPendingFragment, takePendingFragment } from '@/lib/pending-fragment'
import {
  invalidateTwoFactorFlow,
  markVerifyIdle,
  markVerifyServerVerified,
  releaseTwoFactorLease,
  tryAcquireTwoFactorLease,
} from '@/lib/two-factor-verify-flow'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'

const mockedUseSession = useSession as jest.MockedFunction<typeof useSession>
const mockedUseRouter = useRouter as jest.MockedFunction<typeof useRouter>
const mockedUseSearchParams = useSearchParams as jest.MockedFunction<
  typeof useSearchParams
>

const SUBJECT = { id: 'u1', isAdmin: false }

type UpdateBehavior = 'success' | 'staleTrue' | 'null'

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
      return Promise.resolve({
        user: { id: 'u1', isAdmin: false, requiresTwoFactor: true },
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

function submitCode(code: string) {
  fireEvent.change(screen.getByLabelText('backup.codeLabel'), {
    target: { value: code },
  })
  fireEvent.click(screen.getByRole('button', { name: 'backup.submit' }))
}

function resetFlowState() {
  invalidateTwoFactorFlow()
  const lease = tryAcquireTwoFactorLease(null)
  markVerifyIdle(lease)
  releaseTwoFactorLease(lease)
}

beforeEach(() => {
  jest.clearAllMocks()
  resetFlowState()
})

// Unique callback paths per test: the pending-fragment store is module-level.
describe('BackupCodePage fragment restoration', () => {
  it('re-attaches the parked fragment (E2EE key) to the callback URL after success', async () => {
    const { replace } = setup2FASession('/groups/bk')
    succeedingFetch()
    setPendingFragment('/groups/bk', 'KEYbk', SUBJECT)

    render(<BackupCodePage />)
    submitCode('ABCD1234')

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/groups/bk#KEYbk'),
    )
    // Wait for the post-update re-render (requiresTwoFactor=false renders
    // null) so the redirect-away effect has re-fired before asserting it did
    // not steal the navigation with replace('/').
    await waitFor(() =>
      expect(screen.queryByLabelText('backup.codeLabel')).toBeNull(),
    )
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalledWith('/')
  })

  it('navigates to the plain callback URL when no fragment is pending', async () => {
    const { replace } = setup2FASession('/groups/bk-plain')
    succeedingFetch()

    render(<BackupCodePage />)
    submitCode('ABCD1234')

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/groups/bk-plain'),
    )
    await waitFor(() =>
      expect(screen.queryByLabelText('backup.codeLabel')).toBeNull(),
    )
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalledWith('/')
  })

  it('does not navigate or consume the fragment when update() returns null', async () => {
    const { replace } = setup2FASession('/groups/bk-upnull', {
      updateBehavior: 'null',
    })
    succeedingFetch()
    setPendingFragment('/groups/bk-upnull', 'KEYbkupnull', SUBJECT)

    render(<BackupCodePage />)
    submitCode('ABCD1234')

    await waitFor(() =>
      expect(screen.getByText('backup.errors.networkError')).toBeTruthy(),
    )
    expect(replace).not.toHaveBeenCalled()
    // The parked fragment must survive for the retry.
    expect(takePendingFragment('/groups/bk-upnull', SUBJECT)).toBe(
      'KEYbkupnull',
    )
  })

  it('treats a truthy session with requiresTwoFactor still true as a failure', async () => {
    const { replace } = setup2FASession('/groups/bk-stale', {
      updateBehavior: 'staleTrue',
    })
    succeedingFetch()
    setPendingFragment('/groups/bk-stale', 'KEYbkstale', SUBJECT)

    render(<BackupCodePage />)
    submitCode('ABCD1234')

    await waitFor(() =>
      expect(screen.getByText('backup.errors.networkError')).toBeTruthy(),
    )
    expect(replace).not.toHaveBeenCalled()
    expect(takePendingFragment('/groups/bk-stale', SUBJECT)).toBe('KEYbkstale')
  })

  it('recovers from a post-commit 5xx via update() without re-sending the consumed code', async () => {
    const { replace, update } = setup2FASession('/groups/bk-5xx')
    const fetchMock = statusFetch(500, {})
    setPendingFragment('/groups/bk-5xx', 'KEYbk5xx', SUBJECT)

    render(<BackupCodePage />)
    submitCode('ABCD1234')

    await waitFor(() =>
      expect(screen.getByText('backup.errors.verificationFailed')).toBeTruthy(),
    )
    expect(replace).not.toHaveBeenCalled()

    // The code was consumed server-side before the 5xx: the retry must sync
    // the session instead of burning a resend on the consumed code.
    fireEvent.click(screen.getByRole('button', { name: 'backup.submit' }))
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/groups/bk-5xx#KEYbk5xx'),
    )
    expect(update).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalledWith('/')
  })

  it('completes on a 2xx even when the response body fails to parse', async () => {
    const { replace, update } = setup2FASession('/groups/bk-parse')
    const fetchMock = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('bad body')),
      } as unknown as Response),
    )
    global.fetch = fetchMock as unknown as typeof fetch
    setPendingFragment('/groups/bk-parse', 'KEYbkparse', SUBJECT)

    render(<BackupCodePage />)
    submitCode('ABCD1234')

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/groups/bk-parse#KEYbkparse'),
    )
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('releases the lease when the code fails length validation', async () => {
    setup2FASession('/groups/bk-len')
    succeedingFetch()

    render(<BackupCodePage />)
    submitCode('ABC')

    await waitFor(() =>
      expect(screen.getByText('backup.errors.invalidLength')).toBeTruthy(),
    )
    await act(async () => {
      const lease = tryAcquireTwoFactorLease(SUBJECT)
      expect(lease).not.toBeNull()
      releaseTwoFactorLease(lease)
    })
  })
})

describe('BackupCodePage redirect-away behavior', () => {
  it('bounces a direct visit that does not require 2FA to / exactly once', async () => {
    const { replace } = setup2FASession(null, { requiresTwoFactor: false })

    render(<BackupCodePage />)

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
    expect(replace).toHaveBeenCalledTimes(1)
  })

  it('completes a recovered verification with the callback + fragment instead of bouncing to /', async () => {
    const lease = tryAcquireTwoFactorLease(SUBJECT)
    markVerifyServerVerified(lease, SUBJECT)
    releaseTwoFactorLease(lease)
    setPendingFragment('/groups/bk-rc', 'KEYbkrc', SUBJECT)
    const { replace } = setup2FASession('/groups/bk-rc', {
      requiresTwoFactor: false,
    })

    render(<BackupCodePage />)

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/groups/bk-rc#KEYbkrc'),
    )
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalledWith('/')
  })

  it('normalizes a callback pointing back into the verify flow to /', async () => {
    const { replace } = setup2FASession('/auth/verify-2fa/backup')
    succeedingFetch()

    render(<BackupCodePage />)
    submitCode('ABCD1234')

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
    expect(replace).toHaveBeenCalledTimes(1)
  })
})

// Round-4 hardening: transport-unsettled backup dispatches, strict
// fall-through gating, and ALREADY_VERIFIED completion.
describe('BackupCodePage recovery gating', () => {
  it('recovers from a rejected backup dispatch via update() only, without re-sending', async () => {
    const { replace } = setup2FASession('/groups/bk-rej')
    const fetchMock = rejectingFetch()
    setPendingFragment('/groups/bk-rej', 'KEYbkrej', SUBJECT)

    render(<BackupCodePage />)
    submitCode('ABCD1234')
    await waitFor(() =>
      expect(screen.getByText('backup.errors.networkError')).toBeTruthy(),
    )

    // Same code again: update-first succeeds and completes the navigation
    // without ever re-sending the (possibly consumed) code.
    fireEvent.click(screen.getByRole('button', { name: 'backup.submit' }))
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/groups/bk-rej#KEYbkrej'),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never sends another backup code while a rejected dispatch may still be running', async () => {
    const { update } = setup2FASession('/groups/bk-uns', {
      updateBehavior: 'staleTrue',
    })
    const fetchMock = rejectingFetch()

    render(<BackupCodePage />)
    submitCode('ABCD1234')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        (screen.getByLabelText('backup.codeLabel') as HTMLInputElement)
          .disabled,
      ).toBe(false),
    )

    // The rejected request may STILL be rewriting the codes array
    // server-side: even a DIFFERENT backup code must not be sent while the
    // dispatch is unsettled (recover via update() or the TOTP page).
    submitCode('WXYZ9876')
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        (screen.getByLabelText('backup.codeLabel') as HTMLInputElement)
          .disabled,
      ).toBe(false),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('allows a different code after a 5xx: the request got an answer', async () => {
    const { update } = setup2FASession('/groups/bk-5xxd', {
      updateBehavior: 'staleTrue',
    })
    const fetchMock = statusFetch(500, {})

    render(<BackupCodePage />)
    submitCode('ABCD1234')
    await waitFor(() =>
      expect(screen.getByText('backup.errors.verificationFailed')).toBeTruthy(),
    )

    // A 5xx settled the transport (no concurrent rewrite risk); with the
    // sync channel confirmed healthy, a different code is a fresh attempt.
    submitCode('WXYZ9876')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('treats an ALREADY_VERIFIED rejection as success and completes with the fragment', async () => {
    const { replace, update } = setup2FASession('/groups/bk-av')
    statusFetch(400, { error: 'Already verified', code: 'ALREADY_VERIFIED' })
    setPendingFragment('/groups/bk-av', 'KEYbkav', SUBJECT)

    render(<BackupCodePage />)
    submitCode('ABCD1234')

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/groups/bk-av#KEYbkav'),
    )
    expect(update).toHaveBeenCalledTimes(1)
  })
})
