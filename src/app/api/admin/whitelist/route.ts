/**
 * Whitelist User Management API (Issue #4)
 */

import { auth, isPrivateInstance } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'

/**
 * Generate a random initial password with sufficient entropy (Issue #48)
 * Uses 16 bytes (128 bits) of random data for cryptographic strength
 */
function generateInitialPassword(): string {
  return randomBytes(16).toString('base64url').slice(0, 20)
}

export async function POST(request: Request) {
  try {
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

    const body = (await request.json()) as { email?: string; name?: string }
    const { email, name } = body

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 },
      )
    }

    // Check if user already exists
    const existingUser = await prisma.whitelistUser.findUnique({
      where: { email },
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'User already in whitelist' },
        { status: 400 },
      )
    }

    // Check if email is an admin
    const existingAdmin = await prisma.admin.findUnique({
      where: { email },
    })

    if (existingAdmin) {
      return NextResponse.json(
        { error: 'User is already an admin' },
        { status: 400 },
      )
    }

    // Generate initial password
    const initialPassword = generateInitialPassword()
    const hashedPassword = await bcrypt.hash(initialPassword, 12)

    // Create whitelist user with initial password
    const user = await prisma.whitelistUser.create({
      data: {
        email,
        password: hashedPassword,
        name: name || null,
        mustChangePassword: true,
        addedById: session.user.id,
      },
    })

    // Return user with initial password (only shown once!)
    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      },
      initialPassword, // This should be shown to admin to share with user
    })
  } catch (error) {
    console.error('Error adding whitelist user:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}

export async function GET() {
  try {
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

    const users = await prisma.whitelistUser.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ users })
  } catch (error) {
    console.error('Error fetching whitelist users:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
