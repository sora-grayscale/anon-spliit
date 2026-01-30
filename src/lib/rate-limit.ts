/**
 * Rate limiter for authentication (Issue #41)
 *
 * Supports two storage backends:
 * - In-memory (default): Simple, no dependencies, but resets on restart
 *   and doesn't work in distributed environments
 * - Database (optional): Persistent, works in multi-instance deployments
 *   Requires running migrations to create the RateLimitAttempt table
 *
 * Storage is selected via RATE_LIMIT_STORAGE environment variable:
 * - 'memory': Always use in-memory storage (default)
 * - 'database': Use database storage (requires migrations)
 * - 'auto': Try database first, fall back to memory if table doesn't exist
 */

import { prisma } from '@/lib/prisma'

// ============================================================
// Configuration
// ============================================================

const MAX_ATTEMPTS = 5 // Max failed attempts before lockout
const WINDOW_MS = 15 * 60 * 1000 // 15 minute window
const LOCKOUT_MS = 30 * 60 * 1000 // 30 minute lockout after max attempts
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // Cleanup old entries every 5 minutes

// Storage type from environment variable
type StorageType = 'memory' | 'database' | 'auto'
const STORAGE_TYPE: StorageType =
  (process.env.RATE_LIMIT_STORAGE as StorageType) || 'memory'

// ============================================================
// Storage Interface
// ============================================================

interface AttemptRecord {
  count: number
  firstAttempt: number
  lockedUntil?: number
}

interface RateLimitStorage {
  get(key: string): Promise<AttemptRecord | null>
  set(key: string, record: AttemptRecord): Promise<void>
  delete(key: string): Promise<void>
  cleanup(): Promise<void>
}

// ============================================================
// In-Memory Storage (Default)
// ============================================================

class MemoryStorage implements RateLimitStorage {
  private attempts = new Map<string, AttemptRecord>()
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor() {
    this.startCleanup()
  }

  private startCleanup() {
    if (this.cleanupInterval || typeof window !== 'undefined') return
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, CLEANUP_INTERVAL_MS)
  }

  async get(key: string): Promise<AttemptRecord | null> {
    return this.attempts.get(key) || null
  }

  async set(key: string, record: AttemptRecord): Promise<void> {
    this.attempts.set(key, record)
  }

  async delete(key: string): Promise<void> {
    this.attempts.delete(key)
  }

  async cleanup(): Promise<void> {
    const now = Date.now()
    const keysToDelete: string[] = []

    this.attempts.forEach((record, key) => {
      // Remove if window has passed and not locked
      if (!record.lockedUntil && now - record.firstAttempt > WINDOW_MS) {
        keysToDelete.push(key)
      }
      // Remove if lockout has expired
      if (record.lockedUntil && now > record.lockedUntil) {
        keysToDelete.push(key)
      }
    })

    keysToDelete.forEach((key) => this.attempts.delete(key))
  }
}

// ============================================================
// Database Storage (Optional - requires migrations)
// ============================================================

/**
 * Database record type for rate limit attempts
 * Matches the RateLimitAttempt model in schema.prisma
 */
interface DbRateLimitRecord {
  id: string
  count: number
  firstAttempt: Date
  lockedUntil: Date | null
  updatedAt: Date
}

class DatabaseStorage implements RateLimitStorage {
  private tableExists: boolean | null = null

  private async checkTableExists(): Promise<boolean> {
    if (this.tableExists !== null) return this.tableExists

    try {
      // Try to query the table - if it doesn't exist, this will throw
      await prisma.$queryRaw`SELECT 1 FROM "RateLimitAttempt" LIMIT 1`
      this.tableExists = true
    } catch {
      this.tableExists = false
    }

    return this.tableExists
  }

  async get(key: string): Promise<AttemptRecord | null> {
    if (!(await this.checkTableExists())) return null

    try {
      const records = await prisma.$queryRaw<DbRateLimitRecord[]>`
        SELECT id, count, "firstAttempt", "lockedUntil", "updatedAt"
        FROM "RateLimitAttempt"
        WHERE id = ${key}
        LIMIT 1
      `

      if (!records || records.length === 0) return null

      const record = records[0]
      return {
        count: record.count,
        firstAttempt: new Date(record.firstAttempt).getTime(),
        lockedUntil: record.lockedUntil
          ? new Date(record.lockedUntil).getTime()
          : undefined,
      }
    } catch {
      return null
    }
  }

  async set(key: string, record: AttemptRecord): Promise<void> {
    if (!(await this.checkTableExists())) return

    try {
      const firstAttempt = new Date(record.firstAttempt)
      const lockedUntil = record.lockedUntil
        ? new Date(record.lockedUntil)
        : null
      const now = new Date()

      // Use upsert via raw SQL for compatibility
      await prisma.$executeRaw`
        INSERT INTO "RateLimitAttempt" (id, count, "firstAttempt", "lockedUntil", "updatedAt")
        VALUES (${key}, ${record.count}, ${firstAttempt}, ${lockedUntil}, ${now})
        ON CONFLICT (id) DO UPDATE SET
          count = ${record.count},
          "firstAttempt" = ${firstAttempt},
          "lockedUntil" = ${lockedUntil},
          "updatedAt" = ${now}
      `
    } catch {
      // Silently fail - rate limiting is best-effort
    }
  }

  async delete(key: string): Promise<void> {
    if (!(await this.checkTableExists())) return

    try {
      await prisma.$executeRaw`
        DELETE FROM "RateLimitAttempt" WHERE id = ${key}
      `
    } catch {
      // Record might not exist, ignore error
    }
  }

  async cleanup(): Promise<void> {
    if (!(await this.checkTableExists())) return

    const now = new Date()
    const windowCutoff = new Date(now.getTime() - WINDOW_MS)

    try {
      // Delete expired lockouts and old records
      await prisma.$executeRaw`
        DELETE FROM "RateLimitAttempt"
        WHERE ("lockedUntil" IS NOT NULL AND "lockedUntil" < ${now})
           OR ("lockedUntil" IS NULL AND "firstAttempt" < ${windowCutoff})
      `
    } catch {
      // Silently fail
    }
  }
}

// ============================================================
// Storage Factory
// ============================================================

let storage: RateLimitStorage | null = null
let databaseStorage: DatabaseStorage | null = null
let memoryStorage: MemoryStorage | null = null

async function getStorage(): Promise<RateLimitStorage> {
  if (storage) return storage

  if (STORAGE_TYPE === 'database') {
    databaseStorage = new DatabaseStorage()
    storage = databaseStorage
    return storage
  }

  if (STORAGE_TYPE === 'auto') {
    databaseStorage = new DatabaseStorage()
    // Check if database storage is available
    const testRecord = await databaseStorage.get('__test__')
    if (testRecord !== null || (await checkDatabaseAvailable())) {
      storage = databaseStorage
      return storage
    }
    // Fall back to memory
    memoryStorage = new MemoryStorage()
    storage = memoryStorage
    return storage
  }

  // Default: memory storage
  memoryStorage = new MemoryStorage()
  storage = memoryStorage
  return storage
}

async function checkDatabaseAvailable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "RateLimitAttempt" LIMIT 1`
    return true
  } catch {
    return false
  }
}

// For synchronous access (backward compatibility)
function getStorageSync(): RateLimitStorage {
  if (storage) return storage

  // Default to memory storage for sync access
  if (!memoryStorage) {
    memoryStorage = new MemoryStorage()
  }
  return memoryStorage
}

// ============================================================
// Public API (Backward Compatible)
// ============================================================

/**
 * Check if an email is rate limited
 * @returns Object with isLimited flag and optional retryAfter (seconds)
 */
export function checkRateLimit(email: string): {
  isLimited: boolean
  retryAfter?: number
  remainingAttempts?: number
} {
  // Use synchronous check for backward compatibility
  // The actual rate limit check is fast enough with in-memory storage
  const store = getStorageSync()
  const key = email.toLowerCase()
  const now = Date.now()

  // For async storage, we need to handle this differently
  // But for backward compatibility, we use sync memory storage here
  // and async storage for recording attempts

  return checkRateLimitSync(store, key, now)
}

function checkRateLimitSync(
  store: RateLimitStorage,
  key: string,
  now: number,
): {
  isLimited: boolean
  retryAfter?: number
  remainingAttempts?: number
} {
  // This is a sync wrapper - only works with memory storage
  if (!(store instanceof MemoryStorage)) {
    // For database storage, we can't do sync checks
    // Return not limited and let async recording handle it
    return { isLimited: false, remainingAttempts: MAX_ATTEMPTS }
  }

  const memStore = store as MemoryStorage
  // Access internal map directly for sync operation
  const attempts = (
    memStore as unknown as { attempts: Map<string, AttemptRecord> }
  ).attempts
  const record = attempts.get(key)

  if (!record) {
    return { isLimited: false, remainingAttempts: MAX_ATTEMPTS }
  }

  // Check if currently locked out
  if (record.lockedUntil && now < record.lockedUntil) {
    return {
      isLimited: true,
      retryAfter: Math.ceil((record.lockedUntil - now) / 1000),
    }
  }

  // Check if window has expired (reset attempts)
  if (now - record.firstAttempt > WINDOW_MS) {
    attempts.delete(key)
    return { isLimited: false, remainingAttempts: MAX_ATTEMPTS }
  }

  // Check if max attempts reached (should be locked)
  if (record.count >= MAX_ATTEMPTS) {
    // Set lockout
    record.lockedUntil = now + LOCKOUT_MS
    return {
      isLimited: true,
      retryAfter: Math.ceil(LOCKOUT_MS / 1000),
    }
  }

  return {
    isLimited: false,
    remainingAttempts: MAX_ATTEMPTS - record.count,
  }
}

/**
 * Async version of checkRateLimit for database storage
 */
export async function checkRateLimitAsync(email: string): Promise<{
  isLimited: boolean
  retryAfter?: number
  remainingAttempts?: number
}> {
  const store = await getStorage()
  const key = email.toLowerCase()
  const now = Date.now()

  const record = await store.get(key)

  if (!record) {
    return { isLimited: false, remainingAttempts: MAX_ATTEMPTS }
  }

  // Check if currently locked out
  if (record.lockedUntil && now < record.lockedUntil) {
    return {
      isLimited: true,
      retryAfter: Math.ceil((record.lockedUntil - now) / 1000),
    }
  }

  // Check if window has expired (reset attempts)
  if (now - record.firstAttempt > WINDOW_MS) {
    await store.delete(key)
    return { isLimited: false, remainingAttempts: MAX_ATTEMPTS }
  }

  // Check if max attempts reached (should be locked)
  if (record.count >= MAX_ATTEMPTS) {
    // Set lockout
    record.lockedUntil = now + LOCKOUT_MS
    await store.set(key, record)
    return {
      isLimited: true,
      retryAfter: Math.ceil(LOCKOUT_MS / 1000),
    }
  }

  return {
    isLimited: false,
    remainingAttempts: MAX_ATTEMPTS - record.count,
  }
}

/**
 * Record a failed login attempt
 * Uses sync memory storage for immediate effect when available
 */
export function recordFailedAttempt(email: string): void {
  const key = email.toLowerCase()
  const now = Date.now()

  // Use sync memory storage directly for backward compatibility
  const store = getStorageSync()
  if (store instanceof MemoryStorage) {
    const attempts = (
      store as unknown as { attempts: Map<string, AttemptRecord> }
    ).attempts
    const record = attempts.get(key)

    if (!record || now - record.firstAttempt > WINDOW_MS) {
      // Start new window
      attempts.set(key, { count: 1, firstAttempt: now })
    } else {
      // Increment counter
      record.count++
      // If max attempts reached, set lockout
      if (record.count >= MAX_ATTEMPTS) {
        record.lockedUntil = now + LOCKOUT_MS
      }
    }
  } else {
    // Fire and forget for database storage
    recordFailedAttemptAsync(email).catch(() => {
      // Silently fail
    })
  }
}

/**
 * Async version of recordFailedAttempt
 */
export async function recordFailedAttemptAsync(email: string): Promise<void> {
  const store = await getStorage()
  const key = email.toLowerCase()
  const now = Date.now()

  const record = await store.get(key)

  if (!record || now - record.firstAttempt > WINDOW_MS) {
    // Start new window
    await store.set(key, { count: 1, firstAttempt: now })
  } else {
    // Increment counter
    record.count++
    // If max attempts reached, set lockout
    if (record.count >= MAX_ATTEMPTS) {
      record.lockedUntil = now + LOCKOUT_MS
    }
    await store.set(key, record)
  }
}

/**
 * Clear attempts on successful login
 * Uses sync memory storage for immediate effect when available
 */
export function clearAttempts(email: string): void {
  const key = email.toLowerCase()

  // Use sync memory storage directly for backward compatibility
  const store = getStorageSync()
  if (store instanceof MemoryStorage) {
    const attempts = (
      store as unknown as { attempts: Map<string, AttemptRecord> }
    ).attempts
    attempts.delete(key)
  } else {
    // Fire and forget for database storage
    clearAttemptsAsync(email).catch(() => {
      // Silently fail
    })
  }
}

/**
 * Async version of clearAttempts
 */
export async function clearAttemptsAsync(email: string): Promise<void> {
  const store = await getStorage()
  await store.delete(email.toLowerCase())
}

/**
 * Get rate limit configuration (for client display)
 */
export function getRateLimitConfig() {
  return {
    maxAttempts: MAX_ATTEMPTS,
    windowMs: WINDOW_MS,
    lockoutMs: LOCKOUT_MS,
  }
}

/**
 * Get current storage type (for debugging/logging)
 */
export function getStorageType(): string {
  if (storage instanceof DatabaseStorage) return 'database'
  if (storage instanceof MemoryStorage) return 'memory'
  return STORAGE_TYPE // Not yet initialized
}
