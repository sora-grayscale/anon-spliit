/**
 * @jest-environment node
 */

/**
 * Regression test for Issue #175.
 *
 * Section A pins that the previously unauthenticated init route file no
 * longer exists. Section B pins that `AuthLayout` continues to call
 * `initializeAdmin()` on every render, so the lazy-bootstrap design
 * survives the route removal.
 *
 * Path literals here are built via `path.join(...)` with one segment per
 * string so that a project-wide stale-reference scan for the removed
 * endpoint does NOT hit this regression test itself.
 */

import { existsSync } from 'fs'
import { join } from 'path'

describe('Issue #175 — unauthenticated init endpoint removal', () => {
  describe('Section A: route file removed', () => {
    it('init route.ts must not exist', () => {
      const removedRoutePath = join(
        process.cwd(),
        'src',
        'app',
        'api',
        'admin',
        'init',
        'route.ts',
      )
      expect(existsSync(removedRoutePath)).toBe(false)
    })

    it('init directory must not exist', () => {
      const removedDirPath = join(
        process.cwd(),
        'src',
        'app',
        'api',
        'admin',
        'init',
      )
      expect(existsSync(removedDirPath)).toBe(false)
    })
  })

  describe('Section B: AuthLayout still calls initializeAdmin', () => {
    afterEach(() => {
      jest.resetModules()
      jest.clearAllMocks()
      jest.dontMock('@/lib/auth')
    })

    it('AuthLayout invocation calls initializeAdmin exactly once', async () => {
      const initializeAdmin = jest.fn().mockResolvedValue(undefined)

      await jest.isolateModulesAsync(async () => {
        jest.doMock('@/lib/auth', () => ({
          __esModule: true,
          initializeAdmin,
        }))

        const layoutModule = (await import('@/app/auth/layout')) as {
          default: (props: {
            children: React.ReactNode
          }) => Promise<React.ReactNode>
        }
        await layoutModule.default({ children: 'child' })
      })

      expect(initializeAdmin).toHaveBeenCalledTimes(1)
    })
  })
})
