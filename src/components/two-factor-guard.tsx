'use client'

/**
 * Two-Factor Guard Component (Issue #4)
 * Redirects users to 2FA verification page if requiresTwoFactor is true
 */

import { setPendingFragment } from '@/lib/pending-fragment'
import {
  invalidateTwoFactorFlow,
  isVerifyFlowPath,
} from '@/lib/two-factor-verify-flow'
import { Loader2 } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useLayoutEffect, useState } from 'react'

interface TwoFactorGuardProps {
  children: React.ReactNode
  enabled?: boolean
}

// Routes that don't require 2FA check
const excludedRoutes = [
  '/auth/verify-2fa',
  '/auth/verify-2fa/backup',
  '/auth/signin',
  '/auth/error',
]

export function TwoFactorGuard({
  children,
  enabled = false,
}: TwoFactorGuardProps) {
  // Don't render the guard content if 2FA is not enabled
  if (!enabled) {
    return <>{children}</>
  }

  return <TwoFactorGuardContent>{children}</TwoFactorGuardContent>
}

function TwoFactorGuardContent({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const [isChecking, setIsChecking] = useState(true)

  // Leaving the verify flow ends any in-flight verification transaction.
  // Layout effect: it must run synchronously with the commit, before pending
  // promise continuations (microtasks) can resume a surviving closure that
  // would otherwise still own the lease and consume the parked fragment.
  useLayoutEffect(() => {
    if (!isVerifyFlowPath(pathname)) {
      invalidateTwoFactorFlow()
    }
  }, [pathname])

  useEffect(() => {
    // Wait for session to load
    if (status === 'loading') return

    // Don't check if user is not authenticated
    if (status !== 'authenticated') {
      setIsChecking(false)
      return
    }

    // Don't redirect if already on an excluded route
    if (excludedRoutes.some((route) => pathname.startsWith(route))) {
      setIsChecking(false)
      return
    }

    // Redirect to 2FA verification if required
    if (session?.user?.requiresTwoFactor) {
      // Park the URL fragment (the group's E2EE key) before redirecting: it
      // must not ride on callbackUrl (query strings reach the server) and
      // would otherwise be dropped. The store ignores empty writes, so an
      // effect re-run after router.push has already stripped the hash cannot
      // clobber the capture.
      setPendingFragment(pathname, window.location.hash.slice(1), {
        id: session.user.id,
        isAdmin: session.user.isAdmin,
      })
      const callbackUrl = encodeURIComponent(pathname)
      router.push(`/auth/verify-2fa?callbackUrl=${callbackUrl}`)
      return
    }

    setIsChecking(false)
  }, [session, status, pathname, router])

  // Show loading spinner while checking
  if (isChecking) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return <>{children}</>
}
