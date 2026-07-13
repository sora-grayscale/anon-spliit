/** @jest-environment node */

import { sanitizeCallbackUrl } from './safe-callback-url'

describe('sanitizeCallbackUrl on the server (no window)', () => {
  it('rejects absolute URLs fail-closed when our origin is unknown', () => {
    expect(sanitizeCallbackUrl('http://localhost/admin')).toBe('/')
    expect(sanitizeCallbackUrl('https://evil.example/x')).toBe('/')
  })

  it('still accepts plain same-origin paths', () => {
    expect(sanitizeCallbackUrl('/admin')).toBe('/admin')
  })
})
