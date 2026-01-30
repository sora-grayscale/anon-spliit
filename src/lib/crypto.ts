/**
 * E2EE Encryption utilities using Web Crypto API
 *
 * This module provides end-to-end encryption for sensitive group data.
 * The encryption key is stored in the URL fragment and never sent to the server.
 */

// Check if we're in an environment with Web Crypto API
// Works in browsers and in Node.js test environments with jsdom
const isClient =
  typeof globalThis !== 'undefined' && globalThis.crypto?.subtle !== undefined

// ============================================================
// Derived Key Cache (Performance optimization)
// ============================================================

/**
 * Cache for derived CryptoKeys to avoid repeated HKDF operations
 * Key format: `${base64MasterKey}:${purpose}:${saltVersion}`
 * Stores Promise to handle concurrent requests efficiently
 * Bounded by MAX_CACHE_SIZE with simple FIFO (oldest-entry) eviction
 */
const derivedKeyCache = new Map<string, Promise<CryptoKey>>()

/**
 * HKDF salt for key derivation (Issue #40)
 * Using a constant non-zero salt provides better cryptographic hygiene
 * than zero salt, even though zero salt is technically acceptable
 * when the input key has high entropy (RFC 5869)
 */
const HKDF_SALT = new TextEncoder().encode('anon-spliit-hkdf')

/**
 * Maximum cache size to prevent memory leaks in long-running sessions
 */
const MAX_CACHE_SIZE = 100

/**
 * Generate cache key from master key, purpose, and salt version
 */
function getCacheKey(
  masterKey: Uint8Array,
  purpose: string,
  useZeroSalt: boolean = false,
): string {
  const saltVersion = useZeroSalt ? 'v0' : 'v1'
  return `${keyToBase64(masterKey)}:${purpose}:${saltVersion}`
}

/**
 * Clear the derived key cache (useful for testing or key rotation)
 */
export function clearDerivedKeyCache(): void {
  derivedKeyCache.clear()
}

/**
 * Generate a new random master key (256-bit for AES-256)
 * Note: Legacy keys are 128-bit (16 bytes), new keys are 256-bit (32 bytes)
 * The key length determines the AES variant used (Issue #50)
 */
export function generateMasterKey(): Uint8Array {
  if (!isClient) {
    throw new Error('Crypto API not available')
  }
  return crypto.getRandomValues(new Uint8Array(32)) // 256-bit for AES-256
}

/**
 * Convert a key to URL-safe base64 string
 */
export function keyToBase64(key: Uint8Array): string {
  const binary = String.fromCharCode.apply(null, Array.from(key))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Convert a URL-safe base64 string back to key bytes
 */
export function base64ToKey(base64: string): Uint8Array {
  // Restore standard base64
  let standardBase64 = base64.replace(/-/g, '+').replace(/_/g, '/')
  // Add padding if needed
  while (standardBase64.length % 4) {
    standardBase64 += '='
  }
  const binary = atob(standardBase64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Derive an encryption key from the master key using HKDF
 * Uses caching to avoid repeated HKDF operations for the same key
 *
 * @param masterKey - The master encryption key
 * @param purpose - Key purpose for domain separation ('data' or 'metadata')
 * @param useZeroSalt - Use zero salt for backward compatibility with pre-v1 data
 */
export async function deriveKey(
  masterKey: Uint8Array,
  purpose: 'data' | 'metadata' = 'data',
  useZeroSalt: boolean = false,
): Promise<CryptoKey> {
  if (!isClient) {
    throw new Error('Crypto API not available')
  }

  // Check cache first
  const cacheKey = getCacheKey(masterKey, purpose, useZeroSalt)
  const cached = derivedKeyCache.get(cacheKey)
  if (cached) {
    return cached
  }

  // Prevent memory leaks by limiting cache size
  if (derivedKeyCache.size >= MAX_CACHE_SIZE) {
    // Remove oldest entry (first entry in Map)
    const firstKey = derivedKeyCache.keys().next().value
    if (firstKey) {
      derivedKeyCache.delete(firstKey)
    }
  }

  // Create derivation promise and cache it immediately
  // This handles concurrent requests efficiently
  const derivationPromise = (async () => {
    // Import the master key - pass Uint8Array directly (accepted as BufferSource)
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(masterKey),
      'HKDF',
      false,
      ['deriveKey'],
    )

    // Derive the actual encryption key
    const info = new TextEncoder().encode(`spliit-e2ee-${purpose}`)
    // Use proper salt for new data, zero salt for backward compatibility
    const salt = useZeroSalt ? new Uint8Array(16) : HKDF_SALT

    // Determine AES key length based on master key size (Issue #50)
    // - 16-byte master key (legacy) -> AES-128
    // - 32-byte master key (new) -> AES-256
    const aesKeyLength = masterKey.length >= 32 ? 256 : 128

    return crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt,
        info,
      },
      keyMaterial,
      { name: 'AES-GCM', length: aesKeyLength },
      false,
      ['encrypt', 'decrypt'],
    )
  })()

  // Cache the promise
  derivedKeyCache.set(cacheKey, derivationPromise)

  // If derivation fails, remove from cache
  derivationPromise.catch(() => {
    derivedKeyCache.delete(cacheKey)
  })

  return derivationPromise
}

/**
 * Encrypt data using AES-GCM (128 or 256 bit based on key size)
 * Returns base64-encoded ciphertext with IV prepended
 * - 16-byte master key -> AES-128-GCM (legacy)
 * - 32-byte master key -> AES-256-GCM (new, Issue #50)
 */
export async function encrypt(
  data: string,
  masterKey: Uint8Array,
): Promise<string> {
  if (!isClient) {
    throw new Error('Crypto API not available')
  }

  const key = await deriveKey(masterKey, 'data')
  const iv = crypto.getRandomValues(new Uint8Array(12)) // 96-bit IV for GCM
  const encoded = new TextEncoder().encode(data)

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  )

  // Combine IV + ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(ciphertext), iv.length)

  return keyToBase64(combined)
}

/**
 * Decrypt data using AES-GCM (128 or 256 bit based on key size)
 * Tries new salt first, falls back to zero salt for backward compatibility
 * - 16-byte master key -> AES-128-GCM (legacy)
 * - 32-byte master key -> AES-256-GCM (new, Issue #50)
 */
export async function decrypt(
  encryptedData: string,
  masterKey: Uint8Array,
): Promise<string> {
  if (!isClient) {
    throw new Error('Crypto API not available')
  }

  const combined = base64ToKey(encryptedData)

  // Extract IV and ciphertext
  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)

  // Try with new salt first (for data encrypted with v1)
  try {
    const key = await deriveKey(masterKey, 'data', false)
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext,
    )
    return new TextDecoder().decode(decrypted)
  } catch {
    // Fallback to zero salt for backward compatibility (pre-v1 data)
    const legacyKey = await deriveKey(masterKey, 'data', true)
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      legacyKey,
      ciphertext,
    )
    return new TextDecoder().decode(decrypted)
  }
}

/**
 * Encrypt a number (for amounts)
 */
export async function encryptNumber(
  num: number,
  masterKey: Uint8Array,
): Promise<string> {
  return encrypt(num.toString(), masterKey)
}

/**
 * Decrypt a number
 */
export async function decryptNumber(
  encryptedData: string,
  masterKey: Uint8Array,
): Promise<number> {
  const decrypted = await decrypt(encryptedData, masterKey)
  return parseInt(decrypted, 10)
}

/**
 * Encrypt an object (for complex data)
 */
export async function encryptObject<T>(
  obj: T,
  masterKey: Uint8Array,
): Promise<string> {
  return encrypt(JSON.stringify(obj), masterKey)
}

/**
 * Decrypt an object
 */
export async function decryptObject<T>(
  encryptedData: string,
  masterKey: Uint8Array,
): Promise<T> {
  const decrypted = await decrypt(encryptedData, masterKey)
  return JSON.parse(decrypted) as T
}

/**
 * Check if a string looks like encrypted data (base64 with minimum length)
 */
export function isEncrypted(data: string): boolean {
  // Encrypted data will be at least IV (12 bytes) + some ciphertext
  // Base64 encoded, minimum ~20 characters
  if (data.length < 20) return false
  // Check if it's valid URL-safe base64
  return /^[A-Za-z0-9_-]+$/.test(data)
}

/**
 * Get the encryption key from URL fragment
 */
export function getKeyFromFragment(): Uint8Array | null {
  if (typeof window === 'undefined') return null

  const hash = window.location.hash.slice(1) // Remove #
  if (!hash) return null

  try {
    return base64ToKey(hash)
  } catch {
    return null
  }
}

/**
 * Set the encryption key in URL fragment (without triggering navigation)
 */
export function setKeyInFragment(key: Uint8Array): void {
  if (typeof window === 'undefined') return

  const base64Key = keyToBase64(key)
  const newUrl = `${window.location.pathname}${window.location.search}#${base64Key}`
  window.history.replaceState(null, '', newUrl)
}

/**
 * Generate a full group URL with encryption key
 */
export function generateGroupUrl(groupId: string, key: Uint8Array): string {
  const base64Key = keyToBase64(key)
  return `/groups/${groupId}#${base64Key}`
}

// ============================================================
// Password Protection (Issue #2)
// ============================================================

/**
 * PBKDF2 iterations - high count for security
 * 100,000 iterations is recommended minimum for PBKDF2-SHA256
 */
const PBKDF2_ITERATIONS = 100000

/**
 * Generate a random salt for PBKDF2 (16 bytes)
 */
export function generateSalt(): Uint8Array {
  if (!isClient) {
    throw new Error('Crypto API not available')
  }
  return crypto.getRandomValues(new Uint8Array(16))
}

/**
 * Derive an encryption key from a password using PBKDF2
 * @param password - User password
 * @param salt - Random salt (should be stored with group)
 * @param keyLengthBytes - Key length in bytes (16 for AES-128, 32 for AES-256)
 * @returns Derived key as Uint8Array
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
  keyLengthBytes: number = 32, // Default to 256-bit for new groups (Issue #50)
): Promise<Uint8Array> {
  if (!isClient) {
    throw new Error('Crypto API not available')
  }

  // Import password as key material
  const passwordBuffer = new TextEncoder().encode(password)
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveBits'],
  )

  // Derive key using PBKDF2
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    keyLengthBytes * 8, // Convert bytes to bits
  )

  return new Uint8Array(derivedBits)
}

/**
 * Combine two keys using XOR
 * Used to combine URL key with password-derived key for double encryption
 * @param key1 - First key (URL key)
 * @param key2 - Second key (password-derived key)
 * @returns Combined key
 */
export function combineKeys(key1: Uint8Array, key2: Uint8Array): Uint8Array {
  if (key1.length !== key2.length) {
    throw new Error('Keys must be the same length')
  }
  const combined = new Uint8Array(key1.length)
  for (let i = 0; i < key1.length; i++) {
    combined[i] = key1[i] ^ key2[i]
  }
  return combined
}

/**
 * Generate a secure random password
 * Uses a mix of lowercase, uppercase, digits, and symbols
 * @param length - Password length (default: 16)
 * @returns Secure random password string
 */
export function generateSecurePassword(length: number = 16): string {
  if (!isClient) {
    throw new Error('Crypto API not available')
  }

  // Character sets for password generation
  const lowercase = 'abcdefghijklmnopqrstuvwxyz'
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const digits = '0123456789'
  const symbols = '!@#$%^&*()_+-='
  const allChars = lowercase + uppercase + digits + symbols

  // Generate random bytes
  const randomBytes = crypto.getRandomValues(new Uint8Array(length))

  // Build password ensuring at least one of each type
  let password = ''

  // Ensure at least one character from each set
  const ensureChars = [
    lowercase[randomBytes[0] % lowercase.length],
    uppercase[randomBytes[1] % uppercase.length],
    digits[randomBytes[2] % digits.length],
    symbols[randomBytes[3] % symbols.length],
  ]

  // Fill the rest with random characters from all sets
  for (let i = 4; i < length; i++) {
    password += allChars[randomBytes[i] % allChars.length]
  }

  // Add ensured characters at random positions using crypto
  const positionBytes = crypto.getRandomValues(
    new Uint8Array(ensureChars.length),
  )
  for (let i = 0; i < ensureChars.length; i++) {
    const char = ensureChars[i]
    const pos = positionBytes[i] % (password.length + 1)
    password = password.slice(0, pos) + char + password.slice(pos)
  }

  // Trim to exact length (in case we added more than needed)
  return password.slice(0, length)
}

/**
 * Validate password strength
 * @param password - Password to validate
 * @returns Object with validation result and message
 */
export function validatePasswordStrength(password: string): {
  valid: boolean
  message: string
} {
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters' }
  }
  if (password.length > 128) {
    return {
      valid: false,
      message: 'Password must be less than 128 characters',
    }
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain a lowercase letter' }
  }
  if (!/[A-Z]/.test(password)) {
    return {
      valid: false,
      message: 'Password must contain an uppercase letter',
    }
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain a number' }
  }
  return { valid: true, message: 'Password is strong' }
}
