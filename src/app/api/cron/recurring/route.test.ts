/** @jest-environment node */

/**
 * Cron endpoint tests (Issue #169)
 *
 * Read paths no longer trigger `createRecurringExpenses`; this endpoint
 * is now the sole materializer of pending recurring expenses. Verify
 * the route still invokes it on an authorized request.
 */

jest.mock('@/lib/api', () => ({
  createRecurringExpenses: jest.fn(),
}))

jest.mock('@/lib/env', () => ({
  env: {
    CRON_SECRET: 'test-secret',
  },
}))

import { createRecurringExpenses } from '@/lib/api'
import { NextRequest } from 'next/server'
import { POST } from './route'

const mockCreateRecurringExpenses =
  createRecurringExpenses as jest.MockedFunction<typeof createRecurringExpenses>

describe('POST /api/cron/recurring', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('invokes createRecurringExpenses() with no groupId when authorized (Issue #169)', async () => {
    mockCreateRecurringExpenses.mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost/api/cron/recurring', {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret' },
    })
    const response = await POST(req)

    expect(mockCreateRecurringExpenses).toHaveBeenCalledTimes(1)
    expect(mockCreateRecurringExpenses).toHaveBeenCalledWith()
    expect(response.status).toBe(200)
  })

  it('returns 401 without invoking createRecurringExpenses on bad token', async () => {
    const req = new NextRequest('http://localhost/api/cron/recurring', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-secret' },
    })
    const response = await POST(req)

    expect(mockCreateRecurringExpenses).not.toHaveBeenCalled()
    expect(response.status).toBe(401)
  })
})
