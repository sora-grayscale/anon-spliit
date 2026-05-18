import { createRecurringExpenses } from '@/lib/api'
import { env } from '@/lib/env'
import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Cron endpoint for processing recurring expense generation across all groups.
 *
 * Read paths (e.g. `getGroupExpenses`) no longer trigger recurring
 * generation (Issue #169); this endpoint is the sole materializer of
 * pending recurring expenses. Reflection of new recurring expenses
 * therefore depends on the cron schedule defined in `vercel.json`
 * (`0 2 * * *` — daily 02:00 UTC).
 *
 * Authentication: requires CRON_SECRET in the Authorization header.
 * Usage: curl -X POST -H "Authorization: Bearer $CRON_SECRET" /api/cron/recurring
 */
export async function POST(request: NextRequest) {
  if (!env.CRON_SECRET) {
    console.error('CRON_SECRET is not configured - cron endpoint disabled')
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 },
    )
  }

  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '') || ''

  try {
    const expectedBuffer = Buffer.from(env.CRON_SECRET, 'utf-8')
    const receivedBuffer = Buffer.from(token, 'utf-8')

    const isValid =
      expectedBuffer.length === receivedBuffer.length &&
      timingSafeEqual(expectedBuffer, receivedBuffer)

    if (!isValid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await createRecurringExpenses()
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Recurring cron error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}

// Also allow GET for Vercel Cron compatibility
export async function GET(request: NextRequest) {
  return POST(request)
}
