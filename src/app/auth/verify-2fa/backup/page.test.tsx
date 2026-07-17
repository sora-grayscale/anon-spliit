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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  const lease = tryAcquireTwoFactorLease()
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
    setPendingFragment('/groups/bk', 'KEYbk')

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
    setPendingFragment('/groups/bk-upnull', 'KEYbkupnull')

    render(<BackupCodePage />)
    submitCode('ABCD1234')

    await waitFor(() =>
      expect(screen.getByText('backup.errors.networkError')).toBeTruthy(),
    )
    expect(replace).not.toHaveBeenCalled()
    // The parked fragment must survive for the retry.
    expect(takePendingFragment('/groups/bk-upnull')).toBe('KEYbkupnull')
  })

  it('treats a truthy session with requiresTwoFactor still true as a failure', async () => {
    const { replace } = setup2FASession('/groups/bk-stale', {
      updateBehavior: 'staleTrue',
    })
    succeedingFetch()
    setPendingFragment('/groups/bk-stale', 'KEYbkstale')

    render(<BackupCodePage />)
    submitCode('ABCD1234')

    await waitFor(() =>
      expect(screen.getByText('backup.errors.networkError')).toBeTruthy(),
    )
    expect(replace).not.toHaveBeenCalled()
    expect(takePendingFragment('/groups/bk-stale')).toBe('KEYbkstale')
  })

  it('recovers from a post-commit 5xx via update() without re-sending the consumed code', async () => {
    const { replace, update } = setup2FASession('/groups/bk-5xx')
    const fetchMock = statusFetch(500, {})
    setPendingFragment('/groups/bk-5xx', 'KEYbk5xx')

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
    setPendingFragment('/groups/bk-parse', 'KEYbkparse')

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
    const lease = tryAcquireTwoFactorLease()
    expect(lease).not.toBeNull()
    releaseTwoFactorLease(lease)
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
    const lease = tryAcquireTwoFactorLease()
    markVerifyServerVerified(lease, SUBJECT)
    releaseTwoFactorLease(lease)
    setPendingFragment('/groups/bk-rc', 'KEYbkrc')
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
