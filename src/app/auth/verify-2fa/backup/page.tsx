'use client'

/**
 * Backup Code Verification Page (Issue #18)
 *
 * This page allows users to verify their identity using a backup code
 * when they don't have access to their authenticator app.
 * Note: Backup codes are one-time use and will be consumed after verification.
 */

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import {
  clearPendingFragment,
  restorePendingFragment,
} from '@/lib/pending-fragment'
import { sanitizeCallbackUrl } from '@/lib/safe-callback-url'
import {
  getTwoFactorFlowServerVersion,
  getTwoFactorFlowVersion,
  getVerifyOutcome,
  isBackupDispatchUnsettled,
  isTwoFactorLeaseOwner,
  isVerifyFlowPath,
  markVerifyDispatched,
  markVerifyIdle,
  markVerifyResponded,
  markVerifyServerVerified,
  releaseTwoFactorLease,
  subscribeTwoFactorFlow,
  tryAcquireTwoFactorLease,
  wasVerifyTokenDispatched,
} from '@/lib/two-factor-verify-flow'
import {
  AlertCircle,
  AlertTriangle,
  KeyRound,
  Loader2,
  Smartphone,
} from 'lucide-react'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, useSyncExternalStore } from 'react'

export default function BackupCodePage() {
  const t = useTranslations('TwoFactorAuth')
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawCallbackUrl = sanitizeCallbackUrl(searchParams.get('callbackUrl'))
  // A callback pointing back into the verify flow would keep the navigation
  // lease active forever (TwoFactorGuard only invalidates it outside the
  // flow) and strand the user on a blank page; normalize it to '/'.
  const callbackUrl = isVerifyFlowPath(rawCallbackUrl) ? '/' : rawCallbackUrl

  const { data: session, status, update } = useSession()

  const [code, setCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Lease-state version: re-arms the bounce/recovery effect below when the
  // lease changes hands — a page that lost a tryAcquire race once would
  // otherwise never get a second chance (lost wakeup) and render blank
  // forever.
  const flowVersion = useSyncExternalStore(
    subscribeTwoFactorFlow,
    getTwoFactorFlowVersion,
    getTwoFactorFlowServerVersion,
  )

  // Bounce direct visitors who don't need 2FA, and complete a recovered
  // verification. Navigating here requires acquiring the flow lease, so this
  // can never race an in-flight verification transaction (tryAcquire fails
  // while one is active, on THIS page or the TOTP page) and never fires
  // twice (the acquired lease is only invalidated by TwoFactorGuard after
  // landing outside the flow).
  useEffect(() => {
    // Read the version so the lease subscription re-runs this effect.
    void flowVersion
    if (status === 'loading') return
    if (session?.user?.requiresTwoFactor) return

    const user = session?.user
    const subject = user ? { id: user.id, isAdmin: user.isAdmin } : null
    const lease = tryAcquireTwoFactorLease(subject)
    if (lease === null) return

    if (subject && getVerifyOutcome(subject) !== 'idle') {
      // A verification for this subject reached the server before the
      // session flipped (the transaction was interrupted): finish its
      // navigation instead of discarding the parked fragment with a '/'
      // bounce.
      markVerifyIdle(lease)
      router.replace(restorePendingFragment(callbackUrl, subject))
      return
    }

    // Discarding bounce (incl. signed-out): the parked fragment's completion
    // chance is gone — destroy it so it can never re-attach to another
    // subject's navigation.
    clearPendingFragment()
    router.replace('/')
  }, [session, status, router, callbackUrl, flowVersion])

  // Handle code input - only allow alphanumeric and convert to uppercase
  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 8)
    setCode(value)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const user = session?.user
    if (!user) return
    const subject = { id: user.id, isAdmin: user.isAdmin }

    // Exclusive lease: one verification transaction at a time across BOTH
    // verify pages. A second submit while one is in flight (e.g. after
    // switching from the TOTP page mid-request) joins it as a no-op — the
    // in-flight transaction drives the navigation, and its update() will
    // settle the session either way.
    const lease = tryAcquireTwoFactorLease(subject)
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
          router.replace(restorePendingFragment(callbackUrl, subject))
          return
        }
        // A fresh POST is only safe when the sync channel itself is
        // healthy: update() explicitly returned the SAME subject still
        // requiring 2FA. On null / foreign / malformed sessions, burning
        // another code cannot help — keep the outcome and let the user
        // retry the sync. The same dispatched code is never re-sent, and
        // while a backup-code dispatch never got a response (the request
        // may STILL be running server-side), sending a different backup
        // code could race the server's non-CAS rewrite of the codes array
        // (lost update / code resurrection) — recover via the session sync
        // or the TOTP page instead.
        const sessionConfirmsPending =
          updated?.user?.id === subject.id &&
          updated?.user?.isAdmin === subject.isAdmin &&
          updated?.user?.requiresTwoFactor === true
        if (
          !sessionConfirmsPending ||
          wasVerifyTokenDispatched(subject, code) ||
          isBackupDispatchUnsettled(subject) ||
          code.length !== 8
        ) {
          releaseTwoFactorLease(lease)
          setError(t('backup.errors.networkError'))
          return
        }
        // Fall through: fresh attempt with a different code.
      } else if (code.length !== 8) {
        releaseTwoFactorLease(lease)
        setError(t('backup.errors.invalidLength'))
        return
      }

      markVerifyDispatched(lease, subject, code, 'backup')

      const response = await fetch('/api/2fa/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: user.email,
          token: code,
          // The server rejects a body subject that differs from its
          // session, so any non-4xx outcome is attributable to THIS subject
          // even if the cookie switched to a same-email account.
          subjectId: subject.id,
          subjectIsAdmin: subject.isAdmin,
        }),
      })
      if (!isTwoFactorLeaseOwner(lease)) return
      // The dispatch got an answer — the request is no longer running
      // server-side.
      markVerifyResponded(lease)

      // The server committed the verification for this subject: sync the
      // session and finish the navigation. Reached on a 2xx and on the
      // ALREADY_VERIFIED rejection (a success in disguise: e.g. another tab
      // completed first).
      const finishServerVerified = async (): Promise<void> => {
        markVerifyServerVerified(lease, subject)
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
          // 'serverVerified' — the retry syncs the session without
          // re-sending the consumed code.
          releaseTwoFactorLease(lease)
          setError(t('backup.errors.networkError'))
          return
        }
        markVerifyIdle(lease)
        // The lease stays active through the navigation; TwoFactorGuard
        // invalidates it synchronously on the first commit outside the
        // flow. Re-attach the URL fragment (E2EE key) that TwoFactorGuard
        // parked before redirecting here.
        router.replace(restorePendingFragment(callbackUrl, subject))
      }

      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          let errorBody: { error?: string; code?: string } | null = null
          try {
            errorBody = (await response.json()) as {
              error?: string
              code?: string
            }
          } catch {
            // The error body is best-effort.
          }
          if (!isTwoFactorLeaseOwner(lease)) return
          if (errorBody?.code === 'ALREADY_VERIFIED') {
            await finishServerVerified()
            return
          }
          // Definite rejection — the server recorded no verification.
          markVerifyIdle(lease)
          releaseTwoFactorLease(lease)
          setError(errorBody?.error ?? t('backup.errors.verificationFailed'))
          setCode('')
          return
        }
        // 5xx: the server may have committed before failing (the rate-limit
        // cleanup runs after the DB writes), so keep 'outcomeUnknown' — the
        // retry goes update-first and never auto-resends this code.
        releaseTwoFactorLease(lease)
        setError(t('backup.errors.verificationFailed'))
        return
      }

      // 2xx observed — the server committed (and consumed the backup code).
      // The body is not needed on success, and a parse failure must not
      // discard that result.
      await finishServerVerified()
    } catch {
      if (!isTwoFactorLeaseOwner(lease)) return
      releaseTwoFactorLease(lease)
      // A rejected fetch after dispatch keeps 'outcomeUnknown' (the request
      // may have reached the server) — the retry goes update-first.
      setError(t('backup.errors.networkError'))
    } finally {
      setIsLoading(false)
    }
  }

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
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-orange-500/10">
            <KeyRound className="h-6 w-6 text-orange-500" />
          </div>
          <CardTitle className="text-2xl">{t('backup.title')}</CardTitle>
          <CardDescription>{t('backup.description')}</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <Alert
              variant="destructive"
              className="border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-400"
            >
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{t('backup.warning.title')}</AlertTitle>
              <AlertDescription>
                {t('backup.warning.description')}
              </AlertDescription>
            </Alert>

            {error && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="code">{t('backup.codeLabel')}</Label>
              <Input
                id="code"
                type="text"
                autoComplete="off"
                placeholder="XXXXXXXX"
                value={code}
                onChange={handleCodeChange}
                disabled={isLoading}
                autoFocus
                className="text-center text-xl tracking-widest font-mono uppercase"
                maxLength={8}
              />
              <p className="text-xs text-muted-foreground">
                {t('backup.codeHint')}
              </p>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('backup.verifying')}
                </>
              ) : (
                t('backup.submit')
              )}
            </Button>

            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Smartphone className="h-4 w-4" />
              <Link
                href={`/auth/verify-2fa?callbackUrl=${encodeURIComponent(callbackUrl)}`}
                className="text-primary hover:underline"
              >
                {t('backup.useAuthenticator')}
              </Link>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
