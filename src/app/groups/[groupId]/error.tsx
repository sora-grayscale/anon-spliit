'use client'

import { Button } from '@/components/ui/button'
import { AlertCircle, Home, RefreshCw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect } from 'react'

/**
 * Error boundary for group pages
 * Catches errors in group-related components and provides recovery options
 */
export default function GroupError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('Error')

  useEffect(() => {
    console.error('Group error:', error)
  }, [error])

  // Check if it's an encryption-related error
  const isEncryptionError =
    error.message?.includes('decrypt') ||
    error.message?.includes('encrypt') ||
    error.message?.includes('key')

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <AlertCircle className="h-12 w-12 text-destructive" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold">{t('groupTitle')}</h1>
          <p className="text-muted-foreground">
            {isEncryptionError ? t('encryptionError') : t('groupDescription')}
          </p>
        </div>

        {process.env.NODE_ENV === 'development' && error.message && (
          <div className="p-4 bg-muted rounded-lg text-left">
            <p className="text-sm font-mono text-destructive break-all">
              {error.message}
            </p>
            {error.digest && (
              <p className="text-xs text-muted-foreground mt-2">
                Error ID: {error.digest}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={reset} variant="default">
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('retry')}
          </Button>
          <Button asChild variant="outline">
            <Link href="/groups">
              <Home className="h-4 w-4 mr-2" />
              {t('backToGroups')}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
