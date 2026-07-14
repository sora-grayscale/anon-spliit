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

const mockedUseSession = useSession as jest.MockedFunction<typeof useSession>
const mockedUseRouter = useRouter as jest.MockedFunction<typeof useRouter>
const mockedUsePathname = usePathname as jest.MockedFunction<typeof usePathname>

beforeEach(() => {
  jest.clearAllMocks()
})

describe('PasswordChangeGuard / TwoFactorGuard precedence', () => {
  it('pushes only to 2FA when both requiresTwoFactor and mustChangePassword are set', () => {
    const push = jest.fn()
    mockedUseRouter.mockReturnValue({ push } as never)
    mockedUsePathname.mockReturnValue('/dashboard')
    mockedUseSession.mockReturnValue({
      data: {
        user: { requiresTwoFactor: true, mustChangePassword: true },
      },
      status: 'authenticated',
    } as never)

    // Mount order mirrors layout.tsx: PasswordChangeGuard outside,
    // TwoFactorGuard inside.
    render(
      <PasswordChangeGuard enabled>
        <TwoFactorGuard enabled>
          <div>content</div>
        </TwoFactorGuard>
      </PasswordChangeGuard>,
    )

    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith(
      expect.stringContaining('/auth/verify-2fa'),
    )
    expect(push).not.toHaveBeenCalledWith('/auth/change-password')
  })
})
