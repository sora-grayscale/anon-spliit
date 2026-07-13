import { sanitizeCallbackUrl } from './safe-callback-url'

describe('sanitizeCallbackUrl', () => {
  it('falls back to / for empty or missing values', () => {
    expect(sanitizeCallbackUrl(null)).toBe('/')
    expect(sanitizeCallbackUrl(undefined)).toBe('/')
    expect(sanitizeCallbackUrl('')).toBe('/')
  })

  it('allows same-origin absolute paths', () => {
    expect(sanitizeCallbackUrl('/')).toBe('/')
    expect(sanitizeCallbackUrl('/groups/abc')).toBe('/groups/abc')
    expect(sanitizeCallbackUrl('/groups/abc?tab=1#top')).toBe(
      '/groups/abc?tab=1#top',
    )
  })

  it('rejects cross-origin absolute URLs', () => {
    expect(sanitizeCallbackUrl('https://evil.example')).toBe('/')
    expect(sanitizeCallbackUrl('http://evil.example/path')).toBe('/')
    expect(sanitizeCallbackUrl('javascript:alert(1)')).toBe('/')
    // Origin must match exactly: different port, prefix-alike host, and
    // userinfo tricks are all cross-origin. (jsdom origin: http://localhost)
    expect(sanitizeCallbackUrl('http://localhost:3000/admin')).toBe('/')
    expect(sanitizeCallbackUrl('http://localhost.evil.example/x')).toBe('/')
    expect(sanitizeCallbackUrl('http://localhost@evil.example/x')).toBe('/')
  })

  it('reduces same-origin absolute URLs (Auth.js normalization) to their path', () => {
    // @auth/core's default redirect callback turns callbackUrl=/admin into
    // an absolute baseUrl + '/admin' before it reaches the sign-in page.
    expect(sanitizeCallbackUrl('http://localhost/admin')).toBe('/admin')
    expect(sanitizeCallbackUrl('http://localhost/groups/abc?tab=1#top')).toBe(
      '/groups/abc?tab=1#top',
    )
    expect(sanitizeCallbackUrl('HTTP://LOCALHOST/admin')).toBe('/admin')
    expect(sanitizeCallbackUrl('http://localhost')).toBe('/')
  })

  it('does not let a same-origin URL smuggle a protocol-relative path', () => {
    expect(sanitizeCallbackUrl('http://localhost//evil.example')).toBe('/')
  })

  it('rejects protocol-relative URLs', () => {
    expect(sanitizeCallbackUrl('//evil.example')).toBe('/')
    expect(sanitizeCallbackUrl('//evil.example/path')).toBe('/')
  })

  it('rejects backslash variants browsers normalize to protocol-relative', () => {
    expect(sanitizeCallbackUrl('/\\evil.example')).toBe('/')
    expect(sanitizeCallbackUrl('\\\\evil.example')).toBe('/')
  })

  it('rejects control-character smuggling', () => {
    expect(sanitizeCallbackUrl('/\t/\n//evil.example')).toBe('/')
    expect(sanitizeCallbackUrl(' //evil.example')).toBe('/')
  })

  it('supports a custom fallback', () => {
    expect(sanitizeCallbackUrl(null, '/home')).toBe('/home')
    expect(sanitizeCallbackUrl('https://evil.example', '/home')).toBe('/home')
  })

  it('returns the normalized string, which is what reaches router.replace', () => {
    // The return value has the stripped control characters removed, not just
    // the accept/reject decision made from them.
    expect(sanitizeCallbackUrl('/a\r\nb')).toBe('/ab')
  })

  it('rejects a leading space (no longer starts with "/")', () => {
    // A space is not in the strip set, so ' /path' does not start with '/'.
    expect(sanitizeCallbackUrl(' /path')).toBe('/')
  })

  it('rejects control characters outside the strip set', () => {
    expect(sanitizeCallbackUrl('\f/evil')).toBe('/')
    expect(sanitizeCallbackUrl('\x00/x')).toBe('/')
  })

  it('passes through same-origin oddities the browser resolves locally', () => {
    // The browser resolves these against our own origin, so they stay
    // same-origin and are accepted by design.
    expect(sanitizeCallbackUrl('/%2F%2Fevil.example')).toBe(
      '/%2F%2Fevil.example',
    )
    expect(sanitizeCallbackUrl('/..//evil.example')).toBe('/..//evil.example')
  })

  it('holds the fallback to the same rules', () => {
    expect(
      sanitizeCallbackUrl('https://evil.example', 'https://evil2.example'),
    ).toBe('/')
    expect(sanitizeCallbackUrl(null, '/custom')).toBe('/custom')
    expect(sanitizeCallbackUrl(undefined, '//evil')).toBe('/')
  })
})
