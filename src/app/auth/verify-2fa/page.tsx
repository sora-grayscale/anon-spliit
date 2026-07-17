'use client'

/**
 * 2FA Verification Page for Login Flow (Issue #4)
 *
 * This page handles two-factor authentication verification after
 * initial login. Users must enter a 6-digit code from their
 * authenticator app to complete the sign-in process.
 */

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { restorePendingFragment } from '@/lib/pending-fragment'
import { sanitizeCallbackUrl } from '@/lib/safe-callback-url'
import {
  getVerifyOutcome,
  isTwoFactorLeaseOwner,
  isVerifyFlowPath,
  markVerifyDispatched,
  markVerifyIdle,
  markVerifyServerVerified,
  releaseTwoFactorLease,
  tryAcquireTwoFactorLease,
  wasVerifyTokenDispatched,
} from '@/lib/two-factor-verify-flow'
import { AlertCircle, KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

export default function Verify2FAPage() {
  const t = useTranslations('TwoFactorAuth')
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawCallbackUrl = sanitizeCallbackUrl(searchParams.get('callbackUrl'))
  // A callback pointing back into the verify flow would keep the navigation
  // lease active forever (TwoFactorGuard only invalidates it outside the
  // flow) and strand the user on a blank page; normalize it to '/'.
  const callbackUrl = isVerifyFlowPath(rawCallbackUrl) ? '/' : rawCallbackUrl

  const { data: session, status, update } = useSession()

  const [token, setToken] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Last token handed to a submit attempt. Gates the auto-submit effect so a
  // fetch rejection (e.g. offline) does not re-fire the same token in a loop
  // once `isLoading` clears. Cleared on user edit so a re-typed code retries.
  const lastAttemptedTokenRef = useRef<string | null>(null)

  // Bounce direct visitors who don't need 2FA, and complete a recovered
  // verification. Navigating here requires acquiring the flow lease, so this
  // can never race an in-flight verification transaction (tryAcquire fails
  // while one is active, on THIS page or the backup page) and never fires
  // twice (the acquired lease is only invalidated by TwoFactorGuard after
  // landing outside the flow).
  useEffect(() => {
    if (status === 'loading') return
    if (session?.user?.requiresTwoFactor) return

    const lease = tryAcquireTwoFactorLease()
    if (lease === null) return

    const user = session?.user
    if (
      user &&
      getVerifyOutcome({ id: user.id, isAdmin: user.isAdmin }) !== 'idle'
    ) {
      // A verification for this subject reached the server before the
      // session flipped (the transaction was interrupted): finish its
      // navigation instead of discarding the parked fragment with a '/'
      // bounce.
      markVerifyIdle(lease)
      router.replace(restorePendingFragment(callbackUrl))
      return
    }

    router.replace('/')
  }, [session, status, router, callbackUrl])

  // Handle token input - only allow digits and max 6 characters
  const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6)
    // User is editing: re-enable auto-submit so re-entering the same 6 digits
    // retries.
    lastAttemptedTokenRef.current = null
    setToken(value)
  }

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      // Prevent default form submission only if event exists
      if (e) {
        e.preventDefault()
      }

      const user = session?.user
      if (!user) return
      const subject = { id: user.id, isAdmin: user.isAdmin }

      // Exclusive lease: one verification transaction at a time across BOTH
      // verify pages. A second submit while one is in flight (e.g. after
      // switching to the backup page mid-request) joins it as a no-op — the
      // in-flight transaction drives the navigation, and its update() will
      // settle the session either way.
      const lease = tryAcquireTwoFactorLease()
      if (lease === null) return

      setIsLoading(true)
      setError(null)

      try {
        const mode = getVerifyOutcome(subject)

        if (mode !== 'idle') {
          // A previous attempt reached the server ('serverVerified') or its
          // result is unknown (rejected fetch / 5xx may have committed):
          // retry the session sync FIRST instead of re-sending a code. A
          // resend would burn a second backup code or fail on the consumed
          // one. Success requires the SAME subject with the flag cleared.
          const updated = await update({ twoFactorVerified: true })
          if (!isTwoFactorLeaseOwner(lease)) return
          if (
            updated?.user?.id === subject.id &&
            updated?.user?.isAdmin === subject.isAdmin &&
            updated?.user?.requiresTwoFactor === false
          ) {
            markVerifyIdle(lease)
            router.replace(restorePendingFragment(callbackUrl))
            return
          }
          if (
            mode === 'serverVerified' ||
            wasVerifyTokenDispatched(subject, token) ||
            token.length !== 6
          ) {
            // Never auto-resend: 'serverVerified' means the server already
            // committed, and an unknown outcome must not re-send the same
            // code. Only a different, complete code falls through to a
            // fresh attempt.
            releaseTwoFactorLease(lease)
            setError(t('verify.errors.networkError'))
            return
          }
          // Fall through: fresh attempt with a different code.
        } else if (token.length !== 6) {
          releaseTwoFactorLease(lease)
          setError(t('verify.errors.invalidLength'))
          return
        }

        // Record the attempted token synchronously before the request. The
        // auto-submit effect will not re-fire while the ref still equals the
        // current token, so a fetch rejection cannot loop. Setting it here
        // (in both auto and manual paths) also makes a StrictMode
        // double-invoke of the effect a no-op on the second call.
        lastAttemptedTokenRef.current = token
        markVerifyDispatched(lease, subject, token)

        const response = await fetch('/api/2fa/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: user.email,
            token,
          }),
        })
        if (!isTwoFactorLeaseOwner(lease)) return

        if (!response.ok) {
          if (response.status >= 400 && response.status < 500) {
            // Definite rejection — the server recorded no verification.
            markVerifyIdle(lease)
            let message: string | null = null
            try {
              message =
                ((await response.json()) as { error?: string }).error ?? null
            } catch {
              // The error body is best-effort.
            }
            if (!isTwoFactorLeaseOwner(lease)) return
            releaseTwoFactorLease(lease)
            setError(message ?? t('verify.errors.verificationFailed'))
            setToken('')
            return
          }
          // 5xx: the server may have committed before failing (the
          // rate-limit cleanup runs after the DB writes), so keep
          // 'outcomeUnknown' — the retry goes update-first and never
          // auto-resends this code.
          releaseTwoFactorLease(lease)
          setError(t('verify.errors.verificationFailed'))
          return
        }

        // 2xx observed — the server committed. The body is not needed on
        // success, and a parse failure must not discard that result.
        markVerifyServerVerified(lease, subject)

        // Update session to mark 2FA as verified
        const updated = await update({ twoFactorVerified: true })
        if (!isTwoFactorLeaseOwner(lease)) return
        if (
          !(
            updated?.user?.id === subject.id &&
            updated?.user?.isAdmin === subject.isAdmin &&
            updated?.user?.requiresTwoFactor === false
          )
        ) {
          // Session refresh failed (or returned a foreign session):
          // navigating now would bounce back through the guard and consume
          // the parked fragment for nothing. Keep it parked and keep
          // 'serverVerified' — the retry syncs the session without touching
          // the server again.
          releaseTwoFactorLease(lease)
          setError(t('verify.errors.networkError'))
          return
        }

        markVerifyIdle(lease)
        // The lease stays active through the navigation; TwoFactorGuard
        // invalidates it synchronously on the first commit outside the flow.
        // Redirect to the callback URL, re-attaching the URL fragment
        // (E2EE key) that TwoFactorGuard parked before redirecting here.
        router.replace(restorePendingFragment(callbackUrl))
      } catch {
        if (!isTwoFactorLeaseOwner(lease)) return
        releaseTwoFactorLease(lease)
        // A rejected fetch after dispatch keeps 'outcomeUnknown' (the
        // request may have reached the server) — the retry goes
        // update-first.
        setError(t('verify.errors.networkError'))
      } finally {
        setIsLoading(false)
      }
    },
    [token, session?.user, t, update, router, callbackUrl],
  )

  // Auto-submit when 6 digits are entered. Gated on the ref so it fires only
  // for a token that has not already been attempted (prevents the offline
  // re-submit loop and StrictMode double-submit). Manual submit calls
  // handleSubmit directly and bypasses this gate.
  useEffect(() => {
    if (
      token.length === 6 &&
      !isLoading &&
      lastAttemptedTokenRef.current !== token
    ) {
      handleSubmit()
    }
  }, [token, isLoading, handleSubmit])

  // Show loading while checking session
  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Don't render form if user doesn't need 2FA
  if (!session?.user?.requiresTwoFactor) {
    return null
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">{t('verify.title')}</CardTitle>
          <CardDescription>{t('verify.description')}</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="token">{t('verify.codeLabel')}</Label>
              <Input
                id="token"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                placeholder="000000"
                value={token}
                onChange={handleTokenChange}
                disabled={isLoading}
                autoFocus
                className="text-center text-2xl tracking-widest"
                maxLength={6}
              />
              <p className="text-xs text-muted-foreground">
                {t('verify.codeHint')}
              </p>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('verify.verifying')}
                </>
              ) : (
                t('verify.submit')
              )}
            </Button>

            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <KeyRound className="h-4 w-4" />
              <Link
                href={`/auth/verify-2fa/backup?callbackUrl=${encodeURIComponent(callbackUrl)}`}
                className="text-primary hover:underline"
              >
                {t('verify.useBackupCode')}
              </Link>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
