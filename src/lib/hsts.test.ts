import { buildHstsHeader } from './hsts'

describe('buildHstsHeader', () => {
  it('defaults to a 2-year policy without includeSubDomains', () => {
    expect(buildHstsHeader({})).toEqual({
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000',
    })
  })

  it('treats empty-string env values as unset', () => {
    expect(
      buildHstsHeader({
        HSTS_ENABLED: '',
        HSTS_MAX_AGE: '',
        HSTS_INCLUDE_SUBDOMAINS: '',
      }),
    ).toEqual({
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000',
    })
  })

  it('appends includeSubDomains only on explicit opt-in', () => {
    expect(buildHstsHeader({ HSTS_INCLUDE_SUBDOMAINS: 'true' })).toEqual({
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains',
    })
    expect(buildHstsHeader({ HSTS_INCLUDE_SUBDOMAINS: 'on' })?.value).toBe(
      'max-age=63072000; includeSubDomains',
    )
    expect(buildHstsHeader({ HSTS_INCLUDE_SUBDOMAINS: 'false' })?.value).toBe(
      'max-age=63072000',
    )
  })

  it('returns null (app sends no header) when HSTS_ENABLED is false', () => {
    expect(buildHstsHeader({ HSTS_ENABLED: 'false' })).toBeNull()
    expect(buildHstsHeader({ HSTS_ENABLED: 'off' })).toBeNull()
    expect(buildHstsHeader({ HSTS_ENABLED: '0' })).toBeNull()
  })

  it('honors a custom max-age', () => {
    expect(buildHstsHeader({ HSTS_MAX_AGE: '300' })?.value).toBe('max-age=300')
  })

  it('keeps sending max-age=0 (policy deletion), distinct from disabling', () => {
    expect(buildHstsHeader({ HSTS_MAX_AGE: '0' })).toEqual({
      key: 'Strict-Transport-Security',
      value: 'max-age=0',
    })
  })

  it('throws on invalid HSTS_MAX_AGE values', () => {
    for (const invalid of ['abc', '-1', '1.5', '1e3', ' 300', '300 ', '+3']) {
      expect(() => buildHstsHeader({ HSTS_MAX_AGE: invalid })).toThrow(
        /HSTS_MAX_AGE/,
      )
    }
  })

  it('throws on unsafely large HSTS_MAX_AGE values', () => {
    expect(() =>
      buildHstsHeader({ HSTS_MAX_AGE: '99999999999999999999' }),
    ).toThrow(/HSTS_MAX_AGE/)
  })

  it('throws on invalid boolean values instead of guessing', () => {
    expect(() => buildHstsHeader({ HSTS_ENABLED: 'banana' })).toThrow(
      /HSTS_ENABLED/,
    )
    expect(() => buildHstsHeader({ HSTS_INCLUDE_SUBDOMAINS: 'yep' })).toThrow(
      /HSTS_INCLUDE_SUBDOMAINS/,
    )
  })
})
