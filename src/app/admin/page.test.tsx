/**
 * @jest-environment node
 */

/**
 * Server-side gate tests for the admin dashboard (auth-gate hardening).
 *
 * The client TwoFactorGuard / PasswordChangeGuard only run after hydration,
 * so AdminPage must enforce the 2FA / password-change gates server-side
 * BEFORE any Prisma query, or the initial payload would leak serialized
 * admin / whitelist emails. `redirect()` throws NEXT_REDIRECT in Next.js;
 * the mock below reproduces that so we can assert the queries never run.
 */

jest.mock('@/lib/auth', () => ({
  auth: jest.fn(),
  isPrivateInstance: jest.fn(() => true),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    group: { count: jest.fn() },
    admin: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    whitelistUser: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}))

jest.mock('next/navigation', () => ({
  redirect: jest.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

jest.mock('./admin-dashboard', () => ({
  AdminDashboard: () => null,
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import AdminPage from './page'

const mockedAuth = auth as jest.MockedFunction<typeof auth>
const mockedRedirect = redirect as jest.MockedFunction<typeof redirect>
const mockedPrisma = prisma as unknown as {
  group: { count: jest.Mock }
  admin: { count: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock }
  whitelistUser: { count: jest.Mock; findMany: jest.Mock }
}

function makeSession({
  isAdmin = true,
  requiresTwoFactor = false,
  mustChangePassword = false,
}: {
  isAdmin?: boolean
  requiresTwoFactor?: boolean
  mustChangePassword?: boolean
} = {}) {
  return {
    user: {
      id: 'a1',
      email: 'admin@example.com',
      isAdmin,
      mustChangePassword,
      twoFactorEnabled: true,
      requiresTwoFactor,
    },
    expires: '2099-01-01T00:00:00.000Z',
  } as never
}

function expectNoDataQueried() {
  expect(mockedPrisma.group.count).not.toHaveBeenCalled()
  expect(mockedPrisma.admin.count).not.toHaveBeenCalled()
  expect(mockedPrisma.whitelistUser.count).not.toHaveBeenCalled()
  expect(mockedPrisma.admin.findMany).not.toHaveBeenCalled()
  expect(mockedPrisma.whitelistUser.findMany).not.toHaveBeenCalled()
  expect(mockedPrisma.admin.findUnique).not.toHaveBeenCalled()
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('AdminPage server-side auth gates', () => {
  it('redirects to 2FA (before password change) and queries nothing when both are pending', async () => {
    mockedAuth.mockResolvedValue(
      makeSession({ requiresTwoFactor: true, mustChangePassword: true }),
    )

    await expect(AdminPage()).rejects.toThrow(
      'NEXT_REDIRECT:/auth/verify-2fa?callbackUrl=/admin',
    )
    expect(mockedRedirect).toHaveBeenCalledWith(
      '/auth/verify-2fa?callbackUrl=/admin',
    )
    expectNoDataQueried()
  })

  it('redirects to change-password when only a password change is pending', async () => {
    mockedAuth.mockResolvedValue(makeSession({ mustChangePassword: true }))

    await expect(AdminPage()).rejects.toThrow(
      'NEXT_REDIRECT:/auth/change-password',
    )
    expect(mockedRedirect).toHaveBeenCalledWith('/auth/change-password')
    expectNoDataQueried()
  })

  it('queries the dashboard data only after both gates pass', async () => {
    mockedAuth.mockResolvedValue(makeSession())
    mockedPrisma.group.count.mockResolvedValue(0)
    mockedPrisma.admin.count.mockResolvedValue(0)
    mockedPrisma.whitelistUser.count.mockResolvedValue(0)
    mockedPrisma.admin.findMany.mockResolvedValue([])
    mockedPrisma.admin.findUnique.mockResolvedValue({ twoFactorEnabled: true })
    mockedPrisma.whitelistUser.findMany.mockResolvedValue([])

    await AdminPage()

    expect(mockedRedirect).not.toHaveBeenCalled()
    expect(mockedPrisma.admin.findMany).toHaveBeenCalled()
    expect(mockedPrisma.whitelistUser.findMany).toHaveBeenCalled()
  })
})
