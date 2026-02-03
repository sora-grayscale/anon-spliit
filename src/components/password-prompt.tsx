'use client'

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
  base64ToKey,
  combineKeys,
  decrypt,
  deriveKeyFromPassword,
  keyToBase64,
} from '@/lib/crypto'
import { ENCRYPTION_KEY_PREFIX, SESSION_PWD_KEY_PREFIX } from '@/lib/storage'
import { AlertCircle, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

// Rate limiting for brute force protection
const RATE_LIMIT_ATTEMPTS = 5
const RATE_LIMIT_WINDOW_MS = 60000 // 1 minute
const LOCKOUT_DURATION_MS = 300000 // 5 minutes

// localStorage key for persisting rate limit state (Issue #51)
const getStorageKey = (groupId: string) => `password-lockout:${groupId}`

interface RateLimitState {
  attempts: number[]
  lockedUntil: number | null
}

// Safe localStorage access with try/catch (Issue #54)
function loadRateLimitState(groupId: string): RateLimitState | null {
  try {
    const stored = localStorage.getItem(getStorageKey(groupId))
    if (stored) {
      return JSON.parse(stored) as RateLimitState
    }
  } catch {
    // localStorage not available or parse error - ignore
  }
  return null
}

function saveRateLimitState(groupId: string, state: RateLimitState): void {
  try {
    localStorage.setItem(getStorageKey(groupId), JSON.stringify(state))
  } catch {
    // localStorage not available - ignore
  }
}

interface PasswordPromptProps {
  groupId: string
  passwordSalt: string
  passwordHint?: string | null
  urlKey: Uint8Array | null
  encryptedGroupName?: string | null
  onSuccess: (combinedKey: Uint8Array) => void
}

export function PasswordPrompt({
  groupId,
  passwordSalt,
  passwordHint,
  urlKey,
  encryptedGroupName,
  onSuccess,
}: PasswordPromptProps) {
  const t = useTranslations('PasswordPrompt')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<number[]>([])
  const [lockedUntil, setLockedUntil] = useState<number | null>(null)

  // Load persisted rate limit state on mount (Issue #51)
  useEffect(() => {
    const stored = loadRateLimitState(groupId)
    if (stored) {
      const now = Date.now()
      // Restore lockout if still active
      if (stored.lockedUntil && stored.lockedUntil > now) {
        setLockedUntil(stored.lockedUntil)
      }
      // Restore recent attempts (filter out expired ones)
      const recentAttempts = stored.attempts.filter(
        (time) => now - time < RATE_LIMIT_WINDOW_MS,
      )
      if (recentAttempts.length > 0) {
        setAttempts(recentAttempts)
      }
    }
  }, [groupId])

  // Persist rate limit state when it changes (Issue #51)
  useEffect(() => {
    saveRateLimitState(groupId, { attempts, lockedUntil })
  }, [groupId, attempts, lockedUntil])

  // Check rate limit
  const isRateLimited = () => {
    const now = Date.now()

    // Check if currently locked out
    if (lockedUntil && now < lockedUntil) {
      return true
    }

    // Clean old attempts
    const recentAttempts = attempts.filter(
      (time) => now - time < RATE_LIMIT_WINDOW_MS,
    )
    setAttempts(recentAttempts)

    return recentAttempts.length >= RATE_LIMIT_ATTEMPTS
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!password.trim()) {
      setError(t('errors.empty'))
      return
    }

    // Check rate limit
    if (isRateLimited()) {
      const now = Date.now()
      if (!lockedUntil || now >= lockedUntil) {
        // Start lockout
        setLockedUntil(now + LOCKOUT_DURATION_MS)
      }
      setError(t('errors.tooManyAttempts'))
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // Decode salt from base64
      const salt = base64ToKey(passwordSalt)

      // Derive key from password (match URL key length for backward compatibility)
      // - Existing groups with 16-byte URL keys use AES-128
      // - New groups with 32-byte URL keys use AES-256 (Issue #50)
      const keyLengthBytes = urlKey ? urlKey.length : 32
      const passwordKey = await deriveKeyFromPassword(
        password,
        salt,
        keyLengthBytes,
      )

      // Combine with URL key if present, or use password key alone
      const finalKey = urlKey ? combineKeys(urlKey, passwordKey) : passwordKey

      // Verify the password by attempting to decrypt the group name
      if (encryptedGroupName) {
        try {
          await decrypt(encryptedGroupName, finalKey)
        } catch {
          // Decryption failed - wrong password
          setAttempts((prev) => [...prev, Date.now()])
          setError(t('errors.invalid'))
          setPassword('')
          setIsLoading(false)
          return
        }
      }

      // Save to localStorage for this group
      const keyBase64 = keyToBase64(finalKey)
      try {
        localStorage.setItem(`${ENCRYPTION_KEY_PREFIX}${groupId}`, keyBase64)
      } catch {
        // localStorage not available - continue without saving
      }

      // Also save password-derived key separately for session
      sessionStorage.setItem(
        `${SESSION_PWD_KEY_PREFIX}${groupId}`,
        keyToBase64(passwordKey),
      )

      onSuccess(finalKey)
    } catch (err) {
      // Record failed attempt
      setAttempts((prev) => [...prev, Date.now()])
      setError(t('errors.invalid'))
      setPassword('')
    } finally {
      setIsLoading(false)
    }
  }

  const remainingLockoutTime = lockedUntil
    ? Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000))
    : 0

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <KeyRound className="w-6 h-6 text-primary" />
          </div>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {passwordHint && (
              <div className="text-sm text-muted-foreground bg-muted p-3 rounded-md">
                <span className="font-medium">{t('hint')}:</span> {passwordHint}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="password">{t('label')}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('placeholder')}
                  disabled={isLoading || remainingLockoutTime > 0}
                  autoFocus
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="w-4 h-4" />
                {error}
                {remainingLockoutTime > 0 && (
                  <span>
                    {' '}
                    ({Math.floor(remainingLockoutTime / 60)}:
                    {(remainingLockoutTime % 60).toString().padStart(2, '0')})
                  </span>
                )}
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || remainingLockoutTime > 0}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t('unlocking')}
                </>
              ) : (
                t('unlock')
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
