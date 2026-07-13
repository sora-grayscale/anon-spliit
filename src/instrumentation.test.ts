import { register } from './instrumentation'

describe('instrumentation register (startup HSTS validation)', () => {
  const keys = ['HSTS_ENABLED', 'HSTS_MAX_AGE', 'HSTS_INCLUDE_SUBDOMAINS']
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = {}
    for (const k of keys) saved[k] = process.env[k]
  })

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('does not throw for a valid configuration', () => {
    for (const k of keys) delete process.env[k]
    expect(() => register()).not.toThrow()
  })

  it('throws at startup for an invalid configuration (fail-closed)', () => {
    for (const k of keys) delete process.env[k]
    process.env.HSTS_MAX_AGE = 'oops'
    expect(() => register()).toThrow(/HSTS_MAX_AGE/)
  })

  it('validates unconditionally: throws even when HSTS_ENABLED=false', () => {
    for (const k of keys) delete process.env[k]
    process.env.HSTS_ENABLED = 'false'
    process.env.HSTS_MAX_AGE = 'oops'
    expect(() => register()).toThrow(/HSTS_MAX_AGE/)
  })
})
