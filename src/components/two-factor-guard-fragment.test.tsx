/**
 * @jest-environment jsdom
 */

/**
 * Fragment-preservation test for TwoFactorGuard (2FA fragment loss fix).
 *
 * The URL fragment carries the group's E2EE key. When the guard intercepts
 * a navigation and redirects to /auth/verify-2fa, it must park the fragment
 * in the client-only pending-fragment store — never in callbackUrl, which
 * is a query string the server can see — so the verification pages can
 * re-attach it after a successful check.
 */

jest.mock('next-auth/react', () => ({
  useSession: jest.fn(),
}))

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(),
}))

import { TwoFactorGuard } from '@/components/two-factor-guard'
import { setPendingFragment, takePendingFragment } from '@/lib/pending-fragment'
import { render } from '@testing-library/react'
import { useSession } from 'next-auth/react'
import { usePathname, useRouter } from 'next/navigation'
import { StrictMode } from 'react'

const mockedUseSession = useSession as jest.MockedFunction<typeof useSession>
const mockedUseRouter = useRouter as jest.MockedFunction<typeof useRouter>
const mockedUsePathname = usePathname as jest.MockedFunction<typeof usePathname>

function setup(pathname: string, hash: string) {
  const push = jest.fn()
  mockedUseRouter.mockReturnValue({ push } as never)
  mockedUsePathname.mockReturnValue(pathname)
  mockedUseSession.mockReturnValue({
    data: { user: { requiresTwoFactor: true } },
    status: 'authenticated',
  } as never)
  window.location.hash = hash
  return push
}

function renderGuard(wrapper: (node: React.ReactNode) => React.ReactElement) {
  render(
    wrapper(
      <TwoFactorGuard enabled>
        <div>content</div>
      </TwoFactorGuard>,
    ),
  )
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('TwoFactorGuard fragment capture', () => {
  it('parks the fragment for the intercepted path and keeps it out of the redirect URL', () => {
    const push = setup('/groups/cap', '#KEYcap')
    renderGuard((node) => <>{node}</>)

    expect(push).toHaveBeenCalledWith(
      `/auth/verify-2fa?callbackUrl=${encodeURIComponent('/groups/cap')}`,
    )
    // The key must never appear in the navigation target: the query string
    // reaches the server. It is parked in the client-only store instead.
    for (const call of push.mock.calls) {
      expect(String(call[0])).not.toContain('KEYcap')
    }
    expect(takePendingFragment('/groups/cap')).toBe('KEYcap')
  })

  it('leaves a previously parked fragment intact when the hash is empty', () => {
    // Simulates the effect re-running after router.push already stripped the
    // hash from the address bar: the earlier capture must survive.
    setPendingFragment('/groups/empty', 'KEYempty')
    setup('/groups/empty', '')
    renderGuard((node) => <>{node}</>)

    expect(takePendingFragment('/groups/empty')).toBe('KEYempty')
  })

  it('parks exactly one copy under StrictMode effect replay', () => {
    const push = setup('/groups/strict', '#KEYstrict')
    renderGuard((node) => <StrictMode>{node}</StrictMode>)

    expect(push).toHaveBeenCalled()
    expect(takePendingFragment('/groups/strict')).toBe('KEYstrict')
    // One-shot: the replayed effect must not have left a second copy behind.
    expect(takePendingFragment('/groups/strict')).toBeNull()
  })
})
