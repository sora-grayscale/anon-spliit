'use client'

/**
 * Sign In Page for Private Instance Mode (Issue #4)
 */

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { sanitizeCallbackUrl } from '@/lib/safe-callback-url'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'

export default function SignInPage() {
  const searchParams = useSearchParams()
  // Defense-in-depth: Auth.js origin-locks redirects server-side, but we also
  // sanitize here for consistency with the verify-2fa pages rather than depend
  // on the framework default staying default.
  const callbackUrl = sanitizeCallbackUrl(searchParams.get('callbackUrl'))
  const error = searchParams.get('error')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(
    error === 'CredentialsSignin' ? 'Invalid email or password' : null,
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setErrorMessage(null)

    try {
      await signIn('credentials', {
        email,
        password,
        callbackUrl,
        redirect: true,
      })
      // If redirect is true, this code won't be reached on success
    } catch {
      setErrorMessage('An error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Sign In</CardTitle>
          <CardDescription>
            Sign in to access this private instance
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {errorMessage && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {errorMessage}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
