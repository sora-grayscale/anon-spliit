/**
 * @jest-environment jsdom
 */

/**
 * Cross-page integration tests for the 2FA verify-flow lease: a verification
 * transaction started on one page must survive a TOTP <-> backup page switch
 * (closures outlive unmounts), a second submit must join it as a no-op
 * instead of double-posting, and leaving the flow must strip ownership so an
 * orphaned closure can neither consume the parked fragment nor navigate.
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
import Verify2FAPage from '@/app/auth/verify-2fa/page'
import { setPendingFragment, takePendingFragment } from '@/lib/pending-fragment'
import {
  invalidateTwoFactorFlow,
  isTwoFactorLeaseOwner,
  markVerifyIdle,
  releaseTwoFactorLease,
  tryAcquireTwoFactorLease,
} from '@/lib/two-factor-verify-flow'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { StrictMode } from 'react'

const mockedUseSession = useSession as jest.MockedFunction<typeof useSession>
const mockedUseRouter = useRouter as jest.MockedFunction<typeof useRouter>
const mockedUseSearchParams = useSearchParams as jest.MockedFunction<
  typeof useSearchParams
>

function setupSession(callbackUrl: string) {
  const replace = jest.fn()
  mockedUseRouter.mockReturnValue({ replace } as never)
  mockedUseSearchParams.mockReturnValue({
    get: (key: string) => (key === 'callbackUrl' ? callbackUrl : null),
  } as never)
  let requiresTwoFactor = true
  const update = jest.fn(() => {
    requiresTwoFactor = false
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
            requiresTwoFactor,
          },
        },
        status: 'authenticated',
        update,
      }) as never,
  )
  return {
    replace,
    update,
    setRequiresTwoFactor: (value: boolean) => {
      requiresTwoFactor = value
    },
  }
}

function deferredFetch() {
  let resolveFetch: (r: Response) => void = () => {}
  let rejectFetch: (e: unknown) => void = () => {}
  const fetchMock = jest.fn(
    () =>
      new Promise<Response>((res, rej) => {
        resolveFetch = res
        rejectFetch = rej
      }),
  )
  global.fetch = fetchMock as unknown as typeof fetch
  return {
    fetchMock,
    resolveOk: () =>
      act(async () => {
        resolveFetch({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
        } as Response)
        // Drain the transaction's microtask chain (owner check, update()).
        await Promise.resolve()
      }),
    reject: () =>
      act(async () => {
        rejectFetch(new Error('offline'))
        await Promise.resolve()
      }),
  }
}

function typeTotp(value: string) {
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
})

describe('verify-flow transaction across a TOTP <-> backup page switch', () => {
  it('lets the in-flight transaction finish after the page switch: one navigation, fragment consumed once, no / bounce', async () => {
    const { replace, update } = setupSession('/groups/x1')
    const { fetchMock, resolveOk } = deferredFetch()
    setPendingFragment('/groups/x1', 'KEYx1')

    const totp = render(<Verify2FAPage />)
    typeTotp('123456')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    // User switches to the backup page while the request is in flight. The
    // unmount must NOT release the lease — the transaction is still live.
    totp.unmount()
    render(<BackupCodePage />)

    await resolveOk()

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/groups/x1#KEYx1'),
    )
    expect(update).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalledWith('/')
    // One-shot: the transaction consumed the fragment exactly once.
    expect(takePendingFragment('/groups/x1')).toBeNull()
  })

  it('joins a second submit into the in-flight transaction: no extra fetch, one navigation', async () => {
    const { replace, update } = setupSession('/groups/x2')
    const { fetchMock, resolveOk } = deferredFetch()
    setPendingFragment('/groups/x2', 'KEYx2')

    const totp = render(<Verify2FAPage />)
    typeTotp('123456')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    totp.unmount()
    render(<BackupCodePage />)

    // Impatient second submit on the backup page: tryAcquire fails (no
    // steal), so it must be a complete no-op — no second POST, and the
    // original transaction still owns the navigation.
    fireEvent.change(screen.getByLabelText('backup.codeLabel'), {
      target: { value: 'ABCD1234' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'backup.submit' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await resolveOk()

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/groups/x2#KEYx2'),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledTimes(1)
    expect(takePendingFragment('/groups/x2')).toBeNull()
  })

  it('strips ownership when the user leaves the flow: the orphaned closure must not update, navigate, or consume the fragment', async () => {
    const { replace, update } = setupSession('/groups/x3')
    const { fetchMock, resolveOk } = deferredFetch()
    setPendingFragment('/groups/x3', 'KEYx3')

    const totp = render(<Verify2FAPage />)
    typeTotp('123456')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    // User navigates outside the verify flow; TwoFactorGuard invalidates the
    // flow synchronously on that commit.
    totp.unmount()
    invalidateTwoFactorFlow()

    await resolveOk()
    // Give any (incorrect) continuation a chance to run.
    await act(async () => {})

    expect(update).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    // The parked fragment must survive untouched.
    expect(takePendingFragment('/groups/x3')).toBe('KEYx3')
  })

  it('does not let the other page bounce to / when the session flips while the old POST is in flight', async () => {
    const session = setupSession('/groups/x4')
    const { fetchMock, resolveOk } = deferredFetch()
    setPendingFragment('/groups/x4', 'KEYx4')

    const totp = render(<Verify2FAPage />)
    typeTotp('123456')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    totp.unmount()
    // The session reflects requiresTwoFactor=false (e.g. another tab) while
    // the old transaction still owns the lease: the freshly mounted backup
    // page must not steal the navigation with replace('/').
    session.setRequiresTwoFactor(false)
    render(<BackupCodePage />)
    await act(async () => {})
    expect(session.replace).not.toHaveBeenCalled()

    await resolveOk()

    await waitFor(() =>
      expect(session.replace).toHaveBeenCalledWith('/groups/x4#KEYx4'),
    )
    expect(session.replace).toHaveBeenCalledTimes(1)
    expect(session.replace).not.toHaveBeenCalledWith('/')
  })

  it('StrictMode mount/replay of a verify page does not release a lease it does not own', async () => {
    setupSession('/groups/x5')

    // Simulates a transaction owned by the other page being in flight.
    const foreign = tryAcquireTwoFactorLease()
    expect(foreign).not.toBeNull()

    render(
      <StrictMode>
        <BackupCodePage />
      </StrictMode>,
    )
    await act(async () => {})

    expect(isTwoFactorLeaseOwner(foreign)).toBe(true)
    releaseTwoFactorLease(foreign)
  })
})
