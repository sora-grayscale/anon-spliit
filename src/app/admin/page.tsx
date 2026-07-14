/**
 * Admin Dashboard (Issue #4)
 */

import { auth, isPrivateInstance } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { AdminDashboard } from './admin-dashboard'

export default async function AdminPage() {
  // Check if private instance mode is enabled
  if (!isPrivateInstance()) {
    redirect('/')
  }

  // Check authentication
  const session = await auth()
  if (!session?.user) {
    redirect('/auth/signin?callbackUrl=/admin')
  }

  // Check if user is admin
  if (!session.user.isAdmin) {
    redirect('/')
  }

  // Enforce the 2FA / password-change gates server-side before any data is
  // queried or serialized. The client TwoFactorGuard / PasswordChangeGuard
  // only run after hydration, so without this an admin who has not cleared
  // 2FA (or must change their password) would receive the serialized admin
  // and whitelist emails in the initial payload. `redirect()` throws
  // (NEXT_REDIRECT), short-circuiting before the Prisma queries below. 2FA is
  // checked first to match the REST/tRPC ordering.
  if (session.user.requiresTwoFactor) {
    redirect('/auth/verify-2fa?callbackUrl=/admin')
  }
  if (session.user.mustChangePassword) {
    redirect('/auth/change-password')
  }

  // Get stats
  const [groupCount, adminCount, whitelistCount] = await Promise.all([
    prisma.group.count({ where: { deletedAt: null } }),
    prisma.admin.count(),
    prisma.whitelistUser.count(),
  ])

  // Get recent admins (only select necessary fields for security)
  const admins = await prisma.admin.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      twoFactorEnabled: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  // Get current user's 2FA status
  const currentAdmin = await prisma.admin.findUnique({
    where: { email: session.user.email },
    select: { twoFactorEnabled: true },
  })

  // Get whitelist users (only select necessary fields for security)
  const whitelistUsers = await prisma.whitelistUser.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  return (
    <AdminDashboard
      stats={{
        groupCount,
        adminCount,
        whitelistCount,
      }}
      admins={admins.map((a) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
      }))}
      whitelistUsers={whitelistUsers.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
      }))}
      currentUserEmail={session.user.email}
      is2FAEnabled={currentAdmin?.twoFactorEnabled ?? false}
    />
  )
}
