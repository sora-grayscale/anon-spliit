/**
 * Auth Layout - Initializes admin user on first access (Issue #4)
 *
 * This layout ensures the admin user is created automatically when
 * someone accesses the signin page for the first time. Admin bootstrap
 * is handled by this layout; no public init endpoint exists (Issue #175).
 */

import { initializeAdmin } from '@/lib/auth'

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Initialize admin user if it doesn't exist
  // This is safe to call multiple times - it only creates admin if not exists
  await initializeAdmin()

  return <>{children}</>
}
