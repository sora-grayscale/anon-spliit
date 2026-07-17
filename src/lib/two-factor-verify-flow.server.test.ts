/**
 * @jest-environment node
 */

/**
 * Server-side guard for the verify-flow lease: on the server (no `window`)
 * a lease must never be handed out — module state there is shared across
 * every request handled by the process.
 */

import { tryAcquireTwoFactorLease } from '@/lib/two-factor-verify-flow'

describe('two-factor-verify-flow on the server', () => {
  it('never grants a lease', () => {
    expect(typeof window).toBe('undefined')
    expect(tryAcquireTwoFactorLease()).toBeNull()
  })
})
