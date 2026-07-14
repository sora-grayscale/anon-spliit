/**
 * @jest-environment jsdom
 */

/**
 * Precedence test for the two auth guards mounted together in the root
 * layout (auth-gate hardening). When a session has both requiresTwoFactor
 * and mustChangePassword set, PasswordChangeGuard must defer to
 * TwoFactorGuard so exactly one navigation happens (to 2FA) rather than
 * both guards pushing simultaneously.
 */

jest.mock('next-auth/react', () => ({
  useSession: jest.fn(),
}))

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(),
}))

import { PasswordChangeGuard } from '@/components/password-change-guard'
import { TwoFactorGuard } from '@/components/two-factor-guard'
import { render } from '@testing-library/react'
import { useSession } from 'next-auth/react'
import { usePathname, useRouter } from 'next/navigation'
import { StrictMode } from 'react'

const mockedUseSession = useSession as jest.MockedFunction<typeof useSession>
const mockedUseRouter = useRouter as jest.MockedFunction<typeof useRouter>
const mockedUsePathname = usePathname as jest.MockedFunction<typeof usePathname>

function setup(user: {
  requiresTwoFactor?: boolean
  mustChangePassword?: boolean
}) {
  const push = jest.fn()
  mockedUseRouter.mockReturnValue({ push } as never)
  mockedUsePathname.mockReturnValue('/dashboard')
  mockedUseSession.mockReturnValue({
    data: { user },
    status: 'authenticated',
  } as never)
  return push
}

// Mount order mirrors layout.tsx: PasswordChangeGuard outside, TwoFactorGuard
// inside. Both guards mount together and run their redirect effects.
function renderGuards(wrapper: (node: React.ReactNode) => React.ReactElement) {
  render(
    wrapper(
      <PasswordChangeGuard enabled>
        <TwoFactorGuard enabled>
          <div>content</div>
        </TwoFactorGuard>
      </PasswordChangeGuard>,
    ),
  )
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('PasswordChangeGuard / TwoFactorGuard precedence', () => {
  it('pushes only to 2FA when both requiresTwoFactor and mustChangePassword are set', () => {
    const push = setup({ requiresTwoFactor: true, mustChangePassword: true })
    renderGuards((node) => <>{node}</>)

    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith(
      expect.stringContaining('/auth/verify-2fa'),
    )
    expect(push).not.toHaveBeenCalledWith('/auth/change-password')
  })

  it('pushes only to 2FA when requiresTwoFactor alone is set', () => {
    const push = setup({ requiresTwoFactor: true, mustChangePassword: false })
    renderGuards((node) => <>{node}</>)

    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith(
      expect.stringContaining('/auth/verify-2fa'),
    )
  })

  it('pushes only to change-password when mustChangePassword alone is set', () => {
    const push = setup({ requiresTwoFactor: false, mustChangePassword: true })
    renderGuards((node) => <>{node}</>)

    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/auth/change-password')
    expect(push).not.toHaveBeenCalledWith(
      expect.stringContaining('/auth/verify-2fa'),
    )
  })

  it('never mixes both targets under StrictMode effect replay (both flags set)', () => {
    const push = setup({ requiresTwoFactor: true, mustChangePassword: true })
    renderGuards((node) => <StrictMode>{node}</StrictMode>)

    // StrictMode may replay the effect, so the same-target push can repeat,
    // but the 2FA-first invariant must hold: change-password is never pushed.
    expect(push).not.toHaveBeenCalledWith('/auth/change-password')
    for (const call of push.mock.calls) {
      expect(String(call[0])).toContain('/auth/verify-2fa')
    }
  })
})
