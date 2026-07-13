/** @jest-environment node */

import { NextRequest, NextResponse } from 'next/server'

// Env keys that influence the proxy. HSTS_* are read at module load (so the
// module must be re-imported per case); PRIVATE_INSTANCE is read per request.
const MANAGED_ENV_KEYS = [
  'HSTS_ENABLED',
  'HSTS_MAX_AGE',
  'HSTS_INCLUDE_SUBDOMAINS',
  'PRIVATE_INSTANCE',
] as const

type EnvOverrides = Partial<Record<(typeof MANAGED_ENV_KEYS)[number], string>>

const HSTS = 'Strict-Transport-Security'

let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = {}
  for (const key of MANAGED_ENV_KEYS) savedEnv[key] = process.env[key]
})

afterEach(() => {
  for (const key of MANAGED_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  jest.resetModules()
})

// Load a fresh copy of the proxy module with the given env so the module-level
// buildHstsHeader() call is re-evaluated per case (no env bleed between tests).
async function loadProxyModule(env: EnvOverrides) {
  for (const key of MANAGED_ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key]
    else process.env[key] = env[key]
  }
  let mod!: typeof import('./proxy')
  await jest.isolateModulesAsync(async () => {
    mod = await import('./proxy')
  })
  return mod
}

async function loadProxy(env: EnvOverrides) {
  return (await loadProxyModule(env)).proxy
}

function request(path: string, init?: { cookie?: string }) {
  const headers = new Headers()
  if (init?.cookie) headers.set('cookie', init.cookie)
  return new NextRequest(`http://localhost${path}`, { headers })
}

describe('proxy HSTS emission', () => {
  it('sets the default HSTS header on a passthrough (next) response', async () => {
    const proxy = await loadProxy({})
    const res = await proxy(request('/groups/abc'))
    expect(res.headers.get(HSTS)).toBe('max-age=63072000')
  })

  it('sets HSTS on an auth redirect while preserving status and Location', async () => {
    const proxy = await loadProxy({})
    // Public instance blocks /auth/* by redirecting to '/'.
    const res = await proxy(request('/auth/signin'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost/')
    expect(res.headers.get(HSTS)).toBe('max-age=63072000')
  })

  it('sets HSTS on a public route in private-instance mode', async () => {
    const proxy = await loadProxy({ PRIVATE_INSTANCE: 'true' })
    const res = await proxy(request('/auth/signin'))
    expect(res.headers.get(HSTS)).toBe('max-age=63072000')
  })

  it('preserves the callbackUrl Location on the admin auth redirect', async () => {
    const proxy = await loadProxy({ PRIVATE_INSTANCE: 'true' })
    const res = await proxy(request('/admin'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'http://localhost/auth/signin?callbackUrl=%2Fadmin',
    )
    expect(res.headers.get(HSTS)).toBe('max-age=63072000')
  })

  it('sends no HSTS header when HSTS_ENABLED is false (delegated to platform)', async () => {
    const proxy = await loadProxy({ HSTS_ENABLED: 'false' })
    const res = await proxy(request('/groups/abc'))
    expect(res.headers.get(HSTS)).toBeNull()
  })

  it('sends max-age=0 (rollback) rather than omitting the header', async () => {
    const proxy = await loadProxy({ HSTS_MAX_AGE: '0' })
    const res = await proxy(request('/groups/abc'))
    expect(res.headers.get(HSTS)).toBe('max-age=0')
  })

  it('appends includeSubDomains on explicit opt-in', async () => {
    const proxy = await loadProxy({ HSTS_INCLUDE_SUBDOMAINS: 'true' })
    const res = await proxy(request('/groups/abc'))
    expect(res.headers.get(HSTS)).toBe('max-age=63072000; includeSubDomains')
  })

  it('fails closed: importing the proxy throws on an invalid HSTS value', async () => {
    // Clear ALL managed keys first so an ambient HSTS_ENABLED=false in a dev
    // shell cannot influence the result. Validation is unconditional now, but
    // the test stays ambient-proof regardless. afterEach restores the shell env.
    for (const key of MANAGED_ENV_KEYS) delete process.env[key]
    process.env.HSTS_MAX_AGE = 'not-a-number'
    await expect(
      jest.isolateModulesAsync(async () => {
        await import('./proxy')
      }),
    ).rejects.toThrow(/HSTS_MAX_AGE/)
  })
})

describe('proxy routing branches (private instance)', () => {
  it('redirects unauthenticated /groups/create to signin with callbackUrl', async () => {
    const proxy = await loadProxy({ PRIVATE_INSTANCE: 'true' })
    const res = await proxy(request('/groups/create'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'http://localhost/auth/signin?callbackUrl=%2Fgroups%2Fcreate',
    )
    expect(res.headers.get(HSTS)).toBe('max-age=63072000')
  })

  it('passes a static asset (.png) through with HSTS and no redirect', async () => {
    const proxy = await loadProxy({ PRIVATE_INSTANCE: 'true' })
    const res = await proxy(request('/logo.png'))
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get(HSTS)).toBe('max-age=63072000')
  })

  it('allows /admin with a session cookie (no redirect) and sets HSTS', async () => {
    const proxy = await loadProxy({ PRIVATE_INSTANCE: 'true' })
    const res = await proxy(
      request('/admin', { cookie: 'authjs.session-token=x' }),
    )
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get(HSTS)).toBe('max-age=63072000')
  })

  it('passes an unlisted path through the final fallback with HSTS', async () => {
    const proxy = await loadProxy({ PRIVATE_INSTANCE: 'true' })
    const res = await proxy(request('/some-page'))
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get(HSTS)).toBe('max-age=63072000')
  })

  it('serves a shared group link without a cookie and never redirects to signin', async () => {
    // E2EE shared-group invariant: a group is protected by the key in the URL,
    // so unauthenticated access to /groups/<id> must not bounce to signin.
    const proxy = await loadProxy({ PRIVATE_INSTANCE: 'true' })
    const res = await proxy(request('/groups/abc123'))
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get(HSTS)).toBe('max-age=63072000')
  })
})

describe('withSecurityHeaders', () => {
  it('preserves Set-Cookie, status and Location while adding HSTS', async () => {
    const { withSecurityHeaders } = await loadProxyModule({})
    const res = NextResponse.redirect(new URL('http://localhost/x'))
    res.cookies.set('foo', 'bar')
    const out = withSecurityHeaders(res)
    expect(out.status).toBe(307)
    expect(out.headers.get('location')).toBe('http://localhost/x')
    expect(out.headers.get('set-cookie')).toMatch(/foo=bar/)
    expect(out.headers.get(HSTS)).toBe('max-age=63072000')
  })
})
