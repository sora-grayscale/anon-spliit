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

  it('rejects absolute URLs', () => {
    expect(sanitizeCallbackUrl('https://evil.example')).toBe('/')
    expect(sanitizeCallbackUrl('http://evil.example/path')).toBe('/')
    expect(sanitizeCallbackUrl('javascript:alert(1)')).toBe('/')
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
})
