/**
 * Password Change API (Issue #4)
 *
 * Rate limiting added for brute force protection (Issue #43)
 */

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  checkRateLimit,
  clearAttempts,
  recordFailedAttempt,
} from '@/lib/rate-limit'
import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'

// Rate limit key prefix for password change attempts
const RATE_LIMIT_PREFIX = 'password-change:'

export async function POST(request: Request) {
  try {
    const session = await auth()

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check rate limit before processing (Issue #43)
    const rateLimitKey = `${RATE_LIMIT_PREFIX}${session.user.email}`
    const rateLimitResult = checkRateLimit(rateLimitKey)

    if (rateLimitResult.isLimited) {
      return NextResponse.json(
        {
          error: 'Too many password change attempts. Please try again later.',
          retryAfter: rateLimitResult.retryAfter,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimitResult.retryAfter || 60),
          },
        },
      )
    }

    const body = (await request.json()) as {
      currentPassword?: string
      newPassword?: string
    }
    const { currentPassword, newPassword } = body

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'Current password and new password are required' },
        { status: 400 },
      )
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters' },
        { status: 400 },
      )
    }

    if (newPassword === currentPassword) {
      return NextResponse.json(
        { error: 'New password must be different from current password' },
        { status: 400 },
      )
    }

    const userId = session.user.id
    const isAdmin = session.user.isAdmin

    // Get user from database
    let userPassword: string | null = null
    if (isAdmin) {
      const admin = await prisma.admin.findUnique({
        where: { id: userId },
        select: { password: true },
      })
      userPassword = admin?.password ?? null
    } else {
      const whitelistUser = await prisma.whitelistUser.findUnique({
        where: { id: userId },
        select: { password: true },
      })
      userPassword = whitelistUser?.password ?? null
    }

    if (!userPassword) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, userPassword)
    if (!isValidPassword) {
      // Record failed attempt for rate limiting (Issue #43)
      recordFailedAttempt(rateLimitKey)
      return NextResponse.json(
        { error: 'Current password is incorrect' },
        { status: 400 },
      )
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12)

    // Update password and clear mustChangePassword flag
    if (isAdmin) {
      await prisma.admin.update({
        where: { id: userId },
        data: {
          password: hashedPassword,
          mustChangePassword: false,
        },
      })
    } else {
      await prisma.whitelistUser.update({
        where: { id: userId },
        data: {
          password: hashedPassword,
          mustChangePassword: false,
        },
      })
    }

    // Clear rate limit attempts on successful password change (Issue #43)
    clearAttempts(rateLimitKey)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error changing password:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
