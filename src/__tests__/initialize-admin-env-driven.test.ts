/**
 * @jest-environment node
 */

/**
 * Unit tests for `initializeAdmin()` (Issue #175).
 *
 * Pins that bootstrap reads `env.ADMIN_EMAIL` / `env.ADMIN_PASSWORD` via
 * the validated `env` object (NOT raw `process.env`) and respects
 * `env.PRIVATE_INSTANCE`. The previously-unauthenticated `/api/admin/init`
 * route is removed; bootstrap happens only through `src/app/auth/layout.tsx`
 * calling this function on the first signin page hit.
 *
 * The defensive `if (!adminEmail || !adminPassword)` guard inside
 * `initializeAdmin()` is normally unreachable in production because
 * `env.ts:superRefine` requires both when `PRIVATE_INSTANCE=true`. We test
 * the guard anyway so the safety net is pinned.
 *
 * Each test uses `jest.isolateModulesAsync` + `jest.doMock` so the env
 * snapshot is per-case. Top-level stubs cover the NextAuth/Prisma/bcrypt
 * top-level evaluation that happens when `@/lib/auth` is imported.
 */

type EnvShape = {
  PRIVATE_INSTANCE: boolean
  ADMIN_EMAIL: string | undefined
  ADMIN_PASSWORD: string | undefined
}

type PrismaAdminMock = {
  findUnique: jest.Mock
  create: jest.Mock
}

async function loadInitializeAdmin(
  env: EnvShape,
  adminMock: PrismaAdminMock,
): Promise<() => Promise<void>> {
  let initializeAdmin: () => Promise<void> = async () => undefined

  await jest.isolateModulesAsync(async () => {
    jest.doMock('@/lib/env', () => ({
      __esModule: true,
      env,
    }))
    jest.doMock('@/lib/prisma', () => ({
      __esModule: true,
      prisma: { admin: adminMock },
    }))
    jest.doMock('@/lib/rate-limit', () => ({
      __esModule: true,
      checkRateLimitAsync: jest.fn(),
      clearAttemptsAsync: jest.fn(),
      recordFailedAttemptAsync: jest.fn(),
    }))
    jest.doMock('@/lib/auth-jwt', () => ({
      __esModule: true,
      jwtCallback: jest.fn(),
    }))
    jest.doMock('next-auth', () => ({
      __esModule: true,
      default: () => ({
        handlers: {},
        signIn: jest.fn(),
        signOut: jest.fn(),
        auth: jest.fn(),
      }),
    }))
    jest.doMock('next-auth/providers/credentials', () => ({
      __esModule: true,
      default: (config: unknown) => config,
    }))
    jest.doMock('@auth/prisma-adapter', () => ({
      __esModule: true,
      PrismaAdapter: jest.fn(() => ({})),
    }))
    jest.doMock('bcryptjs', () => ({
      __esModule: true,
      default: {
        hash: jest.fn().mockResolvedValue('hashed-password'),
        hashSync: jest.fn(() => 'hashed-sync-dummy'),
        compare: jest.fn(),
      },
    }))

    const mod = (await import('@/lib/auth')) as {
      initializeAdmin: () => Promise<void>
    }
    initializeAdmin = mod.initializeAdmin
  })

  return initializeAdmin
}

describe('initializeAdmin (Issue #175) — env-driven bootstrap', () => {
  let warnSpy: jest.SpyInstance
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    logSpy.mockRestore()
    jest.resetModules()
    jest.clearAllMocks()
    jest.dontMock('@/lib/env')
    jest.dontMock('@/lib/prisma')
    jest.dontMock('@/lib/rate-limit')
    jest.dontMock('@/lib/auth-jwt')
    jest.dontMock('next-auth')
    jest.dontMock('next-auth/providers/credentials')
    jest.dontMock('@auth/prisma-adapter')
    jest.dontMock('bcryptjs')
  })

  it('PRIVATE_INSTANCE=false: no-op (no prisma access)', async () => {
    const adminMock: PrismaAdminMock = {
      findUnique: jest.fn(),
      create: jest.fn(),
    }
    const initializeAdmin = await loadInitializeAdmin(
      {
        PRIVATE_INSTANCE: false,
        ADMIN_EMAIL: 'admin@example.com',
        ADMIN_PASSWORD: 'pw',
      },
      adminMock,
    )

    await initializeAdmin()

    expect(adminMock.findUnique).not.toHaveBeenCalled()
    expect(adminMock.create).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('PRIVATE_INSTANCE=true / ADMIN_EMAIL undefined: warn, no prisma access (defensive guard)', async () => {
    const adminMock: PrismaAdminMock = {
      findUnique: jest.fn(),
      create: jest.fn(),
    }
    const initializeAdmin = await loadInitializeAdmin(
      {
        PRIVATE_INSTANCE: true,
        ADMIN_EMAIL: undefined,
        ADMIN_PASSWORD: 'pw',
      },
      adminMock,
    )

    await initializeAdmin()

    expect(adminMock.findUnique).not.toHaveBeenCalled()
    expect(adminMock.create).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      'PRIVATE_INSTANCE is enabled but ADMIN_EMAIL or ADMIN_PASSWORD is not set',
    )
  })

  it('PRIVATE_INSTANCE=true / ADMIN_PASSWORD undefined: warn, no prisma access (defensive guard)', async () => {
    const adminMock: PrismaAdminMock = {
      findUnique: jest.fn(),
      create: jest.fn(),
    }
    const initializeAdmin = await loadInitializeAdmin(
      {
        PRIVATE_INSTANCE: true,
        ADMIN_EMAIL: 'admin@example.com',
        ADMIN_PASSWORD: undefined,
      },
      adminMock,
    )

    await initializeAdmin()

    expect(adminMock.findUnique).not.toHaveBeenCalled()
    expect(adminMock.create).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      'PRIVATE_INSTANCE is enabled but ADMIN_EMAIL or ADMIN_PASSWORD is not set',
    )
  })

  it('existing admin found: findUnique called but create skipped', async () => {
    const adminMock: PrismaAdminMock = {
      findUnique: jest.fn().mockResolvedValue({ id: 'a1' }),
      create: jest.fn(),
    }
    const initializeAdmin = await loadInitializeAdmin(
      {
        PRIVATE_INSTANCE: true,
        ADMIN_EMAIL: 'admin@example.com',
        ADMIN_PASSWORD: 'pw',
      },
      adminMock,
    )

    await initializeAdmin()

    expect(adminMock.findUnique).toHaveBeenCalledWith({
      where: { email: 'admin@example.com' },
    })
    expect(adminMock.create).not.toHaveBeenCalled()
  })

  it('no existing admin: create called with mustChangePassword=true', async () => {
    const adminMock: PrismaAdminMock = {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'a-new' }),
    }
    const initializeAdmin = await loadInitializeAdmin(
      {
        PRIVATE_INSTANCE: true,
        ADMIN_EMAIL: 'admin@example.com',
        ADMIN_PASSWORD: 'plaintext-pw',
      },
      adminMock,
    )

    await initializeAdmin()

    expect(adminMock.findUnique).toHaveBeenCalledWith({
      where: { email: 'admin@example.com' },
    })
    expect(adminMock.create).toHaveBeenCalledTimes(1)
    const createArg = adminMock.create.mock.calls[0][0] as {
      data: {
        email: string
        password: string
        name: string
        mustChangePassword: boolean
      }
    }
    expect(createArg.data.email).toBe('admin@example.com')
    expect(createArg.data.name).toBe('Admin')
    expect(createArg.data.mustChangePassword).toBe(true)
    // Password is bcrypt-hashed (mocked to 'hashed-password'); confirm the
    // plaintext is NOT what gets stored.
    expect(createArg.data.password).toBe('hashed-password')
    expect(createArg.data.password).not.toBe('plaintext-pw')
  })
})
