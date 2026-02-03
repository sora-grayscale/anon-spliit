'use client'

import { PasswordPrompt } from '@/components/password-prompt'
import {
  base64ToKey,
  decrypt,
  decryptNumber,
  decryptObject,
  encrypt,
  encryptNumber,
  encryptObject,
  generateMasterKey,
  keyToBase64,
} from '@/lib/crypto'
import {
  ENCRYPTION_KEY_PREFIX,
  safeGetItem,
  safeSetItem,
  SESSION_PWD_KEY_PREFIX,
} from '@/lib/storage'
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

/**
 * Extract groupId from current URL path
 */
function getGroupIdFromPath(): string | null {
  if (typeof window === 'undefined') return null
  const match = window.location.pathname.match(/\/groups\/([^/]+)/)
  return match ? match[1] : null
}

/**
 * Save encryption key to localStorage for a group
 */
function saveKeyToStorage(groupId: string, key: Uint8Array): void {
  if (typeof window === 'undefined') return
  const keyBase64 = keyToBase64(key)
  safeSetItem(`${ENCRYPTION_KEY_PREFIX}${groupId}`, keyBase64)
}

/**
 * Load encryption key from localStorage for a group
 */
function loadKeyFromStorage(groupId: string): Uint8Array | null {
  if (typeof window === 'undefined') return null
  const keyBase64 = safeGetItem(`${ENCRYPTION_KEY_PREFIX}${groupId}`)
  if (keyBase64) {
    try {
      const key = base64ToKey(keyBase64)
      // Support both legacy 128-bit (16 bytes) and new 256-bit (32 bytes) keys (Issue #50)
      if (key.length === 16 || key.length === 32) {
        return key
      }
    } catch {
      // Invalid key format - ignore
    }
  }
  return null
}

interface EncryptionContextValue {
  /** The encryption key (null if not available) */
  encryptionKey: Uint8Array | null
  /** The URL key for sharing (same as encryptionKey for non-password groups) */
  urlKey: Uint8Array | null
  /** Whether the key is still being loaded from URL */
  isLoading: boolean
  /** Error message if key is invalid */
  error: string | null
  /** Whether a valid key is available */
  hasKey: boolean
  /** Whether the group requires encryption but key is missing */
  needsKey: boolean
  /** Whether the group requires password entry */
  needsPassword: boolean
  /** Get the key as base64 string */
  getKeyBase64: () => string | null
  /** Get the URL key as base64 string (for sharing) */
  getUrlKeyBase64: () => string | null
  /** Encrypt a string */
  encryptString: (data: string) => Promise<string>
  /** Decrypt a string */
  decryptString: (encrypted: string) => Promise<string>
  /** Encrypt a number */
  encryptNum: (num: number) => Promise<string>
  /** Decrypt a number */
  decryptNum: (encrypted: string) => Promise<number>
  /** Encrypt an object */
  encryptObj: <T>(obj: T) => Promise<string>
  /** Decrypt an object */
  decryptObj: <T>(encrypted: string) => Promise<T>
}

const EncryptionContext = createContext<EncryptionContextValue | null>(null)

interface EncryptionProviderProps {
  children: ReactNode
  /** If true, generate a new key if none exists in URL */
  generateIfMissing?: boolean
  /** Password salt for password-protected groups (base64 encoded) */
  passwordSalt?: string | null
  /** Encrypted password hint */
  passwordHint?: string | null
  /** Encrypted group name for password verification */
  encryptedGroupName?: string | null
}

export function EncryptionProvider({
  children,
  generateIfMissing = false,
  passwordSalt,
  passwordHint,
  encryptedGroupName,
}: EncryptionProviderProps) {
  const [encryptionKey, setEncryptionKey] = useState<Uint8Array | null>(null)
  const [urlKey, setUrlKey] = useState<Uint8Array | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [needsKey, setNeedsKey] = useState(false)
  const [needsPassword, setNeedsPassword] = useState(false)
  const [decryptedHint, setDecryptedHint] = useState<string | null>(null)

  // Function to read URL key from hash
  const readUrlKeyFromHash = useCallback(() => {
    if (typeof window === 'undefined') return null

    const hash = window.location.hash.slice(1)
    if (!hash) return null

    try {
      const key = base64ToKey(hash)
      // Support both legacy 128-bit (16 bytes) and new 256-bit (32 bytes) keys (Issue #50)
      if (key.length === 16 || key.length === 32) {
        return key
      }
    } catch {
      // Invalid key format
    }
    return null
  }, [])

  // Function to restore URL key from localStorage
  const restoreUrlKeyFromStorage = useCallback(() => {
    if (typeof window === 'undefined') return null

    const groupId = getGroupIdFromPath()
    if (!groupId) return null

    // For password-protected groups, we need to check if we have the combined key
    // and extract the URL key from session storage
    const savedKey = loadKeyFromStorage(groupId)
    return savedKey
  }, [])

  // Function to get password-derived key from session storage
  const getSessionPasswordKey = useCallback(() => {
    if (typeof window === 'undefined') return null

    const groupId = getGroupIdFromPath()
    if (!groupId) return null

    try {
      const keyBase64 = sessionStorage.getItem(
        `${SESSION_PWD_KEY_PREFIX}${groupId}`,
      )
      if (keyBase64) {
        return base64ToKey(keyBase64)
      }
    } catch {
      // Session storage not available or invalid key
    }
    return null
  }, [])

  // Handle password entry success
  const handlePasswordSuccess = useCallback((combinedKey: Uint8Array) => {
    setEncryptionKey(combinedKey)
    setNeedsPassword(false)
    setError(null)
  }, [])

  // Read key from URL fragment on mount and handle missing key
  useEffect(() => {
    if (typeof window === 'undefined') return

    const initializeKey = async () => {
      const groupId = getGroupIdFromPath()

      // For password-protected groups, check if we have a session password key
      // If yes, we can try to use the stored combined key directly
      const sessionPwdKey = passwordSalt ? getSessionPasswordKey() : null

      // First try to read URL key from hash
      const hashUrlKey = readUrlKeyFromHash()

      // Also check localStorage for saved key
      const storedKey = restoreUrlKeyFromStorage()

      // CASE 1: Password-protected group with session password key
      // The stored key is already the combined key, use it directly
      if (passwordSalt && sessionPwdKey && storedKey) {
        setEncryptionKey(storedKey)
        setNeedsPassword(false)
        setNeedsKey(false)

        // Update URL with the URL key from hash if available
        if (hashUrlKey) {
          setUrlKey(hashUrlKey)
        }

        setIsLoading(false)
        return
      }

      // CASE 1.5: Password-protected group, just redirected from creation
      // We have both URL key in hash AND combined key in localStorage
      // This happens immediately after group creation before session expires
      if (passwordSalt && hashUrlKey && storedKey) {
        setEncryptionKey(storedKey)
        setUrlKey(hashUrlKey)
        setNeedsPassword(false)
        setNeedsKey(false)
        setIsLoading(false)
        return
      }

      // CASE 2: Password-protected group but no session password key
      // We need the URL key to derive the combined key after password entry
      if (passwordSalt) {
        const urlKeyToUse = hashUrlKey || null
        if (urlKeyToUse) {
          setUrlKey(urlKeyToUse)
          setNeedsPassword(true)
          setNeedsKey(false)

          // Decrypt password hint if available
          if (passwordHint) {
            try {
              const hint = await decrypt(passwordHint, urlKeyToUse)
              setDecryptedHint(hint)
            } catch {
              // Failed to decrypt hint
            }
          }
        } else {
          // No URL key available, need key
          setNeedsKey(true)
        }

        setIsLoading(false)
        return
      }

      // CASE 3: Non-password group
      let currentKey = hashUrlKey

      if (!currentKey) {
        currentKey = storedKey

        // If we have a key from storage, update the URL
        if (currentKey) {
          const keyBase64 = keyToBase64(currentKey)
          const newUrl = `${window.location.pathname}${window.location.search}#${keyBase64}`
          window.history.replaceState(null, '', newUrl)
        }
      } else {
        // Save URL key to localStorage
        if (groupId) {
          saveKeyToStorage(groupId, currentKey)
        }
      }

      // If still no key and we should generate one
      if (!currentKey && generateIfMissing) {
        currentKey = generateMasterKey()
        setError(null)

        // Save to localStorage
        if (groupId) {
          saveKeyToStorage(groupId, currentKey)
        }

        // Update URL without navigation
        const base64Key = keyToBase64(currentKey)
        const newUrl = `${window.location.pathname}${window.location.search}#${base64Key}`
        window.history.replaceState(null, '', newUrl)
      }

      if (currentKey) {
        setEncryptionKey(currentKey)
        setUrlKey(currentKey)
        setNeedsKey(false)
      } else {
        setNeedsKey(true)
      }

      setIsLoading(false)
    }

    initializeKey()

    // Listen for hash changes (mainly for non-password groups)
    const handleHashChange = async () => {
      // For password-protected groups, don't auto-process hash changes
      if (passwordSalt) return

      const newUrlKey = readUrlKeyFromHash()
      if (newUrlKey) {
        setUrlKey(newUrlKey)
        setEncryptionKey(newUrlKey)
        const groupId = getGroupIdFromPath()
        if (groupId) {
          saveKeyToStorage(groupId, newUrlKey)
        }
      }
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [
    generateIfMissing,
    passwordSalt,
    passwordHint,
    readUrlKeyFromHash,
    restoreUrlKeyFromStorage,
    getSessionPasswordKey,
  ])

  // Also check hash periodically in case hashchange event didn't fire
  // This is mainly for non-password groups
  useEffect(() => {
    if (typeof window === 'undefined') return
    // Skip for password-protected groups - handled by main initialization
    if (passwordSalt) return

    const checkHash = () => {
      const hash = window.location.hash.slice(1)
      if (hash && !encryptionKey) {
        const newUrlKey = readUrlKeyFromHash()
        if (newUrlKey) {
          setUrlKey(newUrlKey)
          setEncryptionKey(newUrlKey)
          const groupId = getGroupIdFromPath()
          if (groupId) {
            saveKeyToStorage(groupId, newUrlKey)
          }
        }
      } else if (!hash && !encryptionKey) {
        // Try to restore from localStorage
        const restoredKey = restoreUrlKeyFromStorage()
        if (restoredKey) {
          setUrlKey(restoredKey)
          setEncryptionKey(restoredKey)
          // Update URL with key
          const keyBase64 = keyToBase64(restoredKey)
          const newUrl = `${window.location.pathname}${window.location.search}#${keyBase64}`
          window.history.replaceState(null, '', newUrl)
        }
      }
    }

    // Check immediately
    checkHash()

    // Check again after a short delay (for navigation timing)
    const timer = setTimeout(checkHash, 100)
    return () => clearTimeout(timer)
  }, [
    encryptionKey,
    passwordSalt,
    readUrlKeyFromHash,
    restoreUrlKeyFromStorage,
  ])

  const getKeyBase64 = useCallback(() => {
    if (!encryptionKey) return null
    return keyToBase64(encryptionKey)
  }, [encryptionKey])

  const getUrlKeyBase64 = useCallback(() => {
    if (!urlKey) return null
    return keyToBase64(urlKey)
  }, [urlKey])

  const encryptString = useCallback(
    async (data: string) => {
      if (!encryptionKey) throw new Error('No encryption key available')
      return encrypt(data, encryptionKey)
    },
    [encryptionKey],
  )

  const decryptString = useCallback(
    async (encrypted: string) => {
      if (!encryptionKey) throw new Error('No encryption key available')
      return decrypt(encrypted, encryptionKey)
    },
    [encryptionKey],
  )

  const encryptNum = useCallback(
    async (num: number) => {
      if (!encryptionKey) throw new Error('No encryption key available')
      return encryptNumber(num, encryptionKey)
    },
    [encryptionKey],
  )

  const decryptNum = useCallback(
    async (encrypted: string) => {
      if (!encryptionKey) throw new Error('No encryption key available')
      return decryptNumber(encrypted, encryptionKey)
    },
    [encryptionKey],
  )

  const encryptObj = useCallback(
    async <T,>(obj: T) => {
      if (!encryptionKey) throw new Error('No encryption key available')
      return encryptObject(obj, encryptionKey)
    },
    [encryptionKey],
  )

  const decryptObj = useCallback(
    async <T,>(encrypted: string) => {
      if (!encryptionKey) throw new Error('No encryption key available')
      return decryptObject<T>(encrypted, encryptionKey)
    },
    [encryptionKey],
  )

  const value = useMemo<EncryptionContextValue>(
    () => ({
      encryptionKey,
      urlKey,
      isLoading,
      error,
      hasKey: encryptionKey !== null,
      needsKey,
      needsPassword,
      getKeyBase64,
      getUrlKeyBase64,
      encryptString,
      decryptString,
      encryptNum,
      decryptNum,
      encryptObj,
      decryptObj,
    }),
    [
      encryptionKey,
      urlKey,
      isLoading,
      error,
      needsKey,
      needsPassword,
      getKeyBase64,
      getUrlKeyBase64,
      encryptString,
      decryptString,
      encryptNum,
      decryptNum,
      encryptObj,
      decryptObj,
    ],
  )

  // Get groupId for password prompt
  const groupId = typeof window !== 'undefined' ? getGroupIdFromPath() : null

  return (
    <EncryptionContext.Provider value={value}>
      {needsPassword && passwordSalt && urlKey && groupId ? (
        <PasswordPrompt
          groupId={groupId}
          passwordSalt={passwordSalt}
          passwordHint={decryptedHint}
          urlKey={urlKey}
          encryptedGroupName={encryptedGroupName}
          onSuccess={handlePasswordSuccess}
        />
      ) : (
        children
      )}
    </EncryptionContext.Provider>
  )
}

export function useEncryption() {
  const context = useContext(EncryptionContext)
  if (!context) {
    throw new Error('useEncryption must be used within an EncryptionProvider')
  }
  return context
}

/**
 * Hook that requires encryption key to be present
 * Shows error UI if key is missing
 */
export function useRequireEncryption() {
  const encryption = useEncryption()

  if (encryption.isLoading) {
    return { ...encryption, status: 'loading' as const }
  }

  if (encryption.needsPassword) {
    return { ...encryption, status: 'needs-password' as const }
  }

  if (!encryption.hasKey) {
    return { ...encryption, status: 'missing-key' as const }
  }

  if (encryption.error) {
    return { ...encryption, status: 'error' as const }
  }

  return { ...encryption, status: 'ready' as const }
}
