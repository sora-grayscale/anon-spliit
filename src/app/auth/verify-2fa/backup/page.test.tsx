/**
 * @jest-environment jsdom
 */

/**
 * Fragment restoration test for the backup-code verification page: after a
 * successful backup-code check it must re-attach the URL fragment (E2EE key)
 * parked by TwoFactorGuard, exactly like the TOTP page.
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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'

const mockedUseSession = useSession as jest.MockedFunction<typeof useSession>
const mockedUseRouter = useRouter as jest.MockedFunction<typeof useRouter>
const mockedUseSearchParams = useSearchParams as jest.MockedFunction<
  typeof useSearchParams
>

function setup2FASession(
  callbackUrl: string | null = null,
  { updateSucceeds = true } = {},
) {
  const replace = jest.fn()
  mockedUseRouter.mockReturnValue({ replace } as never)
  mockedUseSearchParams.mockReturnValue({
    get: (key: string) => (key === 'callbackUrl' ? callbackUrl : null),
  } as never)
  // Stateful mock mirroring production: update() makes the refreshed session
  // come back with requiresTwoFactor=false, which re-fires the redirect-away
  // effect (the race gated by the navigation ref).
  let requiresTwoFactor = true
  const update = jest.fn(() => {
    if (!updateSucceeds) return Promise.resolve(null)
    requiresTwoFactor = false
    return Promise.resolve({ user: { email: 'user@example.com' } })
  })
  mockedUseSession.mockImplementation(
    () =>
      ({
        data: {
          user: { email: 'user@example.com', requiresTwoFactor },
        },
        status: 'authenticated',
        update,
      }) as never,
  )
  return replace
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

function submitCode(code: string) {
  fireEvent.change(screen.getByLabelText('backup.codeLabel'), {
    target: { value: code },
  })
  fireEvent.click(screen.getByRole('button', { name: 'backup.submit' }))
}

beforeEach(() => {
  jest.clearAllMocks()
})

// Unique callback paths per test: the pending-fragment store is module-level.
describe('BackupCodePage fragment restoration', () => {
  it('re-attaches the parked fragment (E2EE key) to the callback URL after success', async () => {
    const replace = setup2FASession('/groups/bk')
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
    const replace = setup2FASession('/groups/bk-plain')
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

  it('does not navigate or consume the fragment when the session update fails', async () => {
    const replace = setup2FASession('/groups/bk-upfail', {
      updateSucceeds: false,
    })
    succeedingFetch()
    setPendingFragment('/groups/bk-upfail', 'KEYbkupfail')

    render(<BackupCodePage />)
    submitCode('ABCD1234')

    await waitFor(() =>
      expect(screen.getByText('backup.errors.networkError')).toBeTruthy(),
    )
    expect(replace).not.toHaveBeenCalled()
    // The parked fragment must survive for the retry.
    expect(takePendingFragment('/groups/bk-upfail')).toBe('KEYbkupfail')
  })
})
