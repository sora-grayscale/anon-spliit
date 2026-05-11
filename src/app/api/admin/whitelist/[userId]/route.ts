/**
 * Individual Whitelist User API (Issue #4)
 */

import { auth, isPrivateInstance } from '@/lib/auth'
import { passwordChangeRequiredResponse } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'

function generateInitialPassword(): string {
  return randomBytes(8).toString('base64').slice(0, 12)
}

/**
 * Reset password for a whitelist user
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const { userId } = await params

    // Check if private instance mode is enabled
    if (!isPrivateInstance()) {
      return NextResponse.json(
        { error: 'Private instance mode is not enabled' },
        { status: 400 },
      )
    }

    // Check authentication
    const session = await auth()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const pwChangeResp = passwordChangeRequiredResponse(session)
    if (pwChangeResp) return pwChangeResp

    // Check if user exists
    const user = await prisma.whitelistUser.findUnique({
      where: { id: userId },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Generate new password
    const initialPassword = generateInitialPassword()
    const hashedPassword = await bcrypt.hash(initialPassword, 12)

    // Update user with new password
    await prisma.whitelistUser.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        mustChangePassword: true,
      },
    })

    return NextResponse.json({ initialPassword })
  } catch (error) {
    console.error('Error resetting password:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const { userId } = await params

    // Check if private instance mode is enabled
    if (!isPrivateInstance()) {
      return NextResponse.json(
        { error: 'Private instance mode is not enabled' },
        { status: 400 },
      )
    }

    // Check authentication
    const session = await auth()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const pwChangeResp = passwordChangeRequiredResponse(session)
    if (pwChangeResp) return pwChangeResp

    // Check if user exists
    const user = await prisma.whitelistUser.findUnique({
      where: { id: userId },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Delete user
    await prisma.whitelistUser.delete({
      where: { id: userId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting whitelist user:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
