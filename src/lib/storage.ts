/**
 * Safe localStorage utilities (Issue #54)
 *
 * localStorage can throw exceptions in certain environments:
 * - QuotaExceededError when storage is full
 * - SecurityError in some private browsing modes
 * - TypeError when localStorage is not available
 *
 * These utilities wrap localStorage access in try/catch blocks
 * to handle these edge cases gracefully.
 */

// Storage key prefixes for encryption keys (Issue #94)
export const ENCRYPTION_KEY_PREFIX = 'spliit-e2ee-key-'
export const SESSION_PWD_KEY_PREFIX = 'spliit-pwd-key-'

/**
 * Safely get an item from localStorage
 * @returns The stored value, or null if not found or on error
 */
export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    // localStorage not available or access denied
    return null
  }
}

/**
 * Safely set an item in localStorage
 * @returns true if successful, false on error
 */
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    // localStorage not available, full, or access denied
    console.warn(`Failed to save to localStorage: ${key}`)
    return false
  }
}

/**
 * Safely remove an item from localStorage
 * @returns true if successful, false on error
 */
export function safeRemoveItem(key: string): boolean {
  try {
    localStorage.removeItem(key)
    return true
  } catch {
    // localStorage not available or access denied
    return false
  }
}

/**
 * Safely get and parse JSON from localStorage
 * @returns The parsed value, or defaultValue on error
 */
export function safeGetJSON<T>(key: string, defaultValue: T): T {
  try {
    const item = localStorage.getItem(key)
    if (item === null) return defaultValue
    return JSON.parse(item) as T
  } catch {
    // localStorage not available or parse error
    return defaultValue
  }
}

/**
 * Safely stringify and set JSON in localStorage
 * @returns true if successful, false on error
 */
export function safeSetJSON<T>(key: string, value: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    // localStorage not available, full, or access denied
    console.warn(`Failed to save JSON to localStorage: ${key}`)
    return false
  }
}
