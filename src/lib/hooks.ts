import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'
import useSWR, { Fetcher } from 'swr'
import { base64ToKey, generateMasterKey, keyToBase64 } from './crypto'
import { safeGetItem } from './storage'

export function useMediaQuery(query: string): boolean {
  const getMatches = (query: string): boolean => {
    // Prevents SSR issues
    if (typeof window !== 'undefined') {
      return window.matchMedia(query).matches
    }
    return false
  }

  const [matches, setMatches] = useState<boolean>(getMatches(query))

  function handleChange() {
    setMatches(getMatches(query))
  }

  useEffect(() => {
    const matchMedia = window.matchMedia(query)

    // Triggered at the first client-side load and if query changes
    handleChange()

    // Listen matchMedia
    if (matchMedia.addListener) {
      matchMedia.addListener(handleChange)
    } else {
      matchMedia.addEventListener('change', handleChange)
    }

    return () => {
      if (matchMedia.removeListener) {
        matchMedia.removeListener(handleChange)
      } else {
        matchMedia.removeEventListener('change', handleChange)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  return matches
}

export function useBaseUrl() {
  const [baseUrl, setBaseUrl] = useState<string | null>(null)
  useEffect(() => {
    setBaseUrl(window.location.origin)
  }, [])
  return baseUrl
}

/**
 * @returns The active user, or `null` until it is fetched from local storage
 */
export function useActiveUser(groupId?: string) {
  const [activeUser, setActiveUser] = useState<string | null>(null)

  useEffect(() => {
    if (groupId) {
      const activeUser = safeGetItem(`${groupId}-activeUser`)
      if (activeUser) setActiveUser(activeUser)
    }
  }, [groupId])

  return activeUser
}

interface FrankfurterAPIResponse {
  base: string
  date: string
  rates: Record<string, number>
}

const fetcher: Fetcher<FrankfurterAPIResponse> = (url: string) =>
  fetch(url).then(async (res) => {
    if (!res.ok)
      throw new TypeError('Unsuccessful response from API', { cause: res })
    return res.json() as Promise<FrankfurterAPIResponse>
  })

export function useCurrencyRate(
  date: Date,
  baseCurrency: string,
  targetCurrency: string,
) {
  const dateString = dayjs(date).format('YYYY-MM-DD')

  // Only send request if both currency codes are given and not the same
  const url =
    !isNaN(date.getTime()) &&
    !!baseCurrency.length &&
    !!targetCurrency.length &&
    baseCurrency !== targetCurrency &&
    `https://api.frankfurter.app/${dateString}?base=${baseCurrency}`
  const { data, error, isLoading, mutate } = useSWR<FrankfurterAPIResponse>(
    url,
    fetcher,
    { shouldRetryOnError: false, revalidateOnFocus: false },
  )

  if (data) {
    let exchangeRate = undefined
    let sentError = error
    if (!error && data.date !== dateString) {
      // this happens if for example, the requested date is in the future.
      sentError = new RangeError(data.date)
    }
    if (data.rates[targetCurrency]) {
      exchangeRate = data.rates[targetCurrency]
    }
    return {
      data: exchangeRate,
      error: sentError,
      isLoading,
      refresh: mutate,
    }
  }

  return {
    data,
    error,
    isLoading,
    refresh: mutate,
  }
}

/**
 * Hook to manage encryption key from URL fragment
 * The key is stored in the URL hash and never sent to the server
 */
export function useEncryptionKey() {
  const [encryptionKey, setEncryptionKey] = useState<Uint8Array | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Read key from URL fragment on mount
  useEffect(() => {
    if (typeof window === 'undefined') return

    const hash = window.location.hash.slice(1)
    if (hash) {
      try {
        const key = base64ToKey(hash)
        if (key.length === 16) {
          setEncryptionKey(key)
          setError(null)
        } else {
          setError('Invalid encryption key length')
        }
      } catch {
        setError('Invalid encryption key format')
      }
    }
    setIsLoading(false)

    // Listen for hash changes
    const handleHashChange = () => {
      const newHash = window.location.hash.slice(1)
      if (newHash) {
        try {
          const key = base64ToKey(newHash)
          if (key.length === 16) {
            setEncryptionKey(key)
            setError(null)
          }
        } catch {
          // Ignore invalid hashes
        }
      }
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  // Generate a new key and update URL
  const generateKey = useCallback(() => {
    const newKey = generateMasterKey()
    setEncryptionKey(newKey)
    setError(null)

    // Update URL without navigation
    const base64Key = keyToBase64(newKey)
    const newUrl = `${window.location.pathname}${window.location.search}#${base64Key}`
    window.history.replaceState(null, '', newUrl)

    return newKey
  }, [])

  // Get the key as base64 string
  const getKeyBase64 = useCallback(() => {
    if (!encryptionKey) return null
    return keyToBase64(encryptionKey)
  }, [encryptionKey])

  return {
    encryptionKey,
    isLoading,
    error,
    hasKey: encryptionKey !== null,
    generateKey,
    getKeyBase64,
  }
}

// Re-export from hooks directory
export { useBalances } from './hooks/useBalances'
