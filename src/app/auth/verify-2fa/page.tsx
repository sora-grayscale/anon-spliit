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
  const callbackUrl = sanitizeCallbackUrl(searchParams.get('callbackUrl'))

  const { data: session, status, update } = useSession()

  const [token, setToken] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Last token handed to a submit attempt. Gates the auto-submit effect so a
  // fetch rejection (e.g. offline) does not re-fire the same token in a loop
  // once `isLoading` clears. Cleared on user edit so a re-typed code retries.
  const lastAttemptedTokenRef = useRef<string | null>(null)

  // Redirect if user doesn't require 2FA verification
  useEffect(() => {
    if (status === 'loading') return

    // If no session or doesn't require 2FA, redirect to home
    if (!session?.user?.requiresTwoFactor) {
      router.replace('/')
    }
  }, [session, status, router])

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

      if (token.length !== 6) {
        setError(t('verify.errors.invalidLength'))
        return
      }

      // Record the attempted token synchronously before the request. The
      // auto-submit effect will not re-fire while the ref still equals the
      // current token, so a fetch rejection cannot loop. Setting it here (in
      // both auto and manual paths) also makes a StrictMode double-invoke of
      // the effect a no-op on the second call. Not cleared in catch/finally.
      lastAttemptedTokenRef.current = token

      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/2fa/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: session?.user?.email,
            token,
          }),
        })

        const data = (await response.json()) as { error?: string }

        if (!response.ok) {
          setError(data.error ?? t('verify.errors.verificationFailed'))
          setToken('')
          return
        }

        // Update session to mark 2FA as verified
        await update({ twoFactorVerified: true })

        // Redirect to callback URL or home, re-attaching the URL fragment
        // (E2EE key) that TwoFactorGuard parked before redirecting here.
        router.replace(restorePendingFragment(callbackUrl))
      } catch {
        setError(t('verify.errors.networkError'))
      } finally {
        setIsLoading(false)
      }
    },
    [token, session?.user?.email, t, update, router, callbackUrl],
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
