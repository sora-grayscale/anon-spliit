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
import { restorePendingFragment } from '@/lib/pending-fragment'
import { sanitizeCallbackUrl } from '@/lib/safe-callback-url'
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
import { useEffect, useState } from 'react'

export default function BackupCodePage() {
  const t = useTranslations('TwoFactorAuth')
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = sanitizeCallbackUrl(searchParams.get('callbackUrl'))

  const { data: session, status, update } = useSession()

  const [code, setCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Redirect if user doesn't require 2FA verification
  useEffect(() => {
    if (status === 'loading') return

    // If no session or doesn't require 2FA, redirect to home
    if (!session?.user?.requiresTwoFactor) {
      router.replace('/')
    }
  }, [session, status, router])

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

    if (code.length !== 8) {
      setError(t('backup.errors.invalidLength'))
      return
    }

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
          token: code,
        }),
      })

      const data = (await response.json()) as {
        error?: string
        usedBackupCode?: boolean
      }

      if (!response.ok) {
        setError(data.error ?? t('backup.errors.verificationFailed'))
        setCode('')
        return
      }

      // Update session to mark 2FA as verified
      await update({ twoFactorVerified: true })

      // Redirect to callback URL or home, re-attaching the URL fragment
      // (E2EE key) that TwoFactorGuard parked before redirecting here.
      router.replace(restorePendingFragment(callbackUrl))
    } catch {
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
