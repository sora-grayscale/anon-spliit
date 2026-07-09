/**
 * E2EE Encryption helpers for group data
 *
 * These helpers encrypt/decrypt sensitive fields in group data.
 * The encryption key comes from the URL fragment and is never sent to the server.
 */

import { decrypt, decryptNumber, encrypt, encryptNumber } from './crypto'
import { ExpenseFormValues, GroupFormValues } from './schemas'

export class EncryptedDataDecryptionError extends Error {
  readonly entity: 'group' | 'expense' | 'activity'
  readonly reason = 'invalid-ciphertext-or-key'
  readonly cause: unknown

  constructor(entity: 'group' | 'expense' | 'activity', cause: unknown) {
    super(`Failed to decrypt encrypted ${entity} data`)
    this.name = 'EncryptedDataDecryptionError'
    this.entity = entity
    this.cause = cause
  }
}

// Type for expense data with encrypted amounts (stored in DB)
export interface EncryptedExpenseData {
  title: string // encrypted
  notes?: string | null // encrypted
  amount: string // encrypted number
  originalAmount?: string // encrypted number
  paidFor: Array<{
    participant: string
    shares: string // encrypted number
  }>
}

// Types for encrypted data (stored in DB as base64 strings)
export interface EncryptedGroupFormValues {
  name: string // encrypted
  information?: string // encrypted
  currency: string // encrypted (Issue #22)
  currencyCode?: string | null // encrypted (Issue #22)
  participants: Array<{
    id?: string
    name: string // encrypted
  }>
}

export interface DecryptedGroup {
  id: string
  name: string
  information: string | null
  currency: string
  currencyCode: string | null
  participants: Array<{
    id: string
    name: string
  }>
}

/**
 * Encrypt group form values before sending to server
 */
export async function encryptGroupFormValues(
  values: GroupFormValues,
  encryptionKey: Uint8Array,
): Promise<EncryptedGroupFormValues> {
  const encryptedName = await encrypt(values.name, encryptionKey)
  const encryptedInformation = values.information
    ? await encrypt(values.information, encryptionKey)
    : undefined

  // Encrypt currency fields (Issue #22 - E2EE for currency)
  const encryptedCurrency = await encrypt(values.currency, encryptionKey)
  const encryptedCurrencyCode = values.currencyCode
    ? await encrypt(values.currencyCode, encryptionKey)
    : null

  const encryptedParticipants = await Promise.all(
    values.participants.map(async (p) => ({
      id: p.id,
      name: await encrypt(p.name, encryptionKey),
    })),
  )

  return {
    name: encryptedName,
    information: encryptedInformation,
    currency: encryptedCurrency,
    currencyCode: encryptedCurrencyCode,
    participants: encryptedParticipants,
  }
}

/**
 * Decrypt group data received from server
 */
export async function decryptGroup<
  T extends {
    id: string
    name: string
    information: string | null
    currency: string
    currencyCode: string | null
    participants: Array<{ id: string; name: string }>
  },
>(group: T, encryptionKey: Uint8Array): Promise<T> {
  const groupNameLooksEncrypted = looksEncrypted(group.name)
  const groupLooksEncrypted =
    groupNameLooksEncrypted &&
    (looksEncrypted(group.currency) ||
      Boolean(group.currencyCode && looksEncrypted(group.currencyCode)) ||
      group.participants.some((p) => looksEncrypted(p.name)) ||
      Boolean(group.information && looksEncrypted(group.information)))

  try {
    const decryptedName = groupNameLooksEncrypted
      ? await decrypt(group.name, encryptionKey)
      : group.name
    const decryptedInformation =
      group.information && looksEncrypted(group.information)
        ? await decrypt(group.information, encryptionKey)
        : group.information

    // Decrypt currency fields (Issue #22 - E2EE for currency)
    // Handle backward compatibility for legacy unencrypted data
    const decryptedCurrency = looksEncrypted(group.currency)
      ? await decrypt(group.currency, encryptionKey)
      : group.currency
    const decryptedCurrencyCode =
      group.currencyCode && looksEncrypted(group.currencyCode)
        ? await decrypt(group.currencyCode, encryptionKey)
        : group.currencyCode

    const decryptedParticipants = await Promise.all(
      group.participants.map(async (p) => ({
        ...p,
        name: looksEncrypted(p.name)
          ? await decrypt(p.name, encryptionKey)
          : p.name,
      })),
    )

    return {
      ...group,
      name: decryptedName,
      information: decryptedInformation,
      currency: decryptedCurrency,
      currencyCode: decryptedCurrencyCode,
      participants: decryptedParticipants,
    }
  } catch (error) {
    if (groupLooksEncrypted) {
      throw new EncryptedDataDecryptionError('group', error)
    }

    // If decryption fails, return original data (might be unencrypted legacy data)
    // Note: Don't log error details as they may contain sensitive information
    console.warn(
      'Group decryption failed - returning original data (may be legacy unencrypted)',
    )
    return group
  }
}

/**
 * Check if a string looks like it might be encrypted (Issue #112)
 * Supports both v1 format (version byte + IV + ciphertext) and legacy format
 * Minimum encrypted payload: IV(12 bytes) + GCM tag(16 bytes) + 1 byte = 29 bytes
 * In base64: ceil(29 * 4/3) = 39 characters (legacy), 40+ characters (v1 with version byte)
 */
export function looksEncrypted(value: string): boolean {
  // Minimum length check: base64 of at least 29 bytes (legacy) ≈ 20 chars
  if (value.length < 20) return false
  // Must be valid URL-safe base64
  return /^[A-Za-z0-9_-]+$/.test(value)
}

/**
 * Encrypt expense form values before sending to server
 * This encrypts title, notes, category, amount, originalAmount, originalCurrency, and shares
 */
export async function encryptExpenseFormValues(
  values: ExpenseFormValues,
  encryptionKey: Uint8Array,
): Promise<ExpenseFormValues> {
  const encryptedTitle = await encrypt(values.title, encryptionKey)
  const encryptedNotes = values.notes
    ? await encrypt(values.notes, encryptionKey)
    : undefined

  // Encrypt category (Issue #19 - E2EE for categories)
  const categoryNum =
    typeof values.category === 'string'
      ? parseInt(values.category, 10)
      : values.category
  const encryptedCategory = await encryptNumber(categoryNum, encryptionKey)

  // Encrypt amount (convert to number first if needed, then encrypt)
  const amountNum =
    typeof values.amount === 'string'
      ? parseFloat(values.amount)
      : values.amount
  const encryptedAmount = await encryptNumber(amountNum, encryptionKey)

  // Encrypt originalAmount if present
  let encryptedOriginalAmount: string | undefined
  if (values.originalAmount !== undefined && values.originalAmount !== '') {
    const origAmountNum =
      typeof values.originalAmount === 'string'
        ? parseFloat(values.originalAmount)
        : values.originalAmount
    encryptedOriginalAmount = await encryptNumber(origAmountNum, encryptionKey)
  }

  // Encrypt originalCurrency if present (Issue #22 - E2EE for currency)
  const encryptedOriginalCurrency = values.originalCurrency
    ? await encrypt(values.originalCurrency, encryptionKey)
    : undefined

  // Encrypt shares for each paidFor entry
  const encryptedPaidFor = await Promise.all(
    values.paidFor.map(async (pf) => {
      const sharesNum =
        typeof pf.shares === 'string' ? parseFloat(pf.shares) : pf.shares
      const encryptedShares = await encryptNumber(sharesNum, encryptionKey)
      return {
        ...pf,
        shares: encryptedShares,
      }
    }),
  )

  return {
    ...values,
    title: encryptedTitle,
    notes: encryptedNotes,
    category: encryptedCategory as unknown as number, // Type assertion for schema compatibility
    amount: encryptedAmount as unknown as number, // Type assertion for schema compatibility
    originalAmount: encryptedOriginalAmount as unknown as number | undefined,
    originalCurrency: encryptedOriginalCurrency,
    paidFor: encryptedPaidFor as unknown as ExpenseFormValues['paidFor'],
  }
}

/**
 * Decrypt expense data received from server
 * This decrypts title, notes, category, amount, originalAmount, originalCurrency, and shares
 */
export async function decryptExpense<
  T extends {
    title: string
    notes?: string | null
    categoryId?: string | number // Can be encrypted string or legacy integer
    amount: string | number
    originalAmount?: string | number | null
    originalCurrency?: string | null // Can be encrypted or legacy plain text (Issue #22)
    paidFor?: Array<{
      shares: string | number
      participant?: { id: string; name: string }
    }>
  },
>(expense: T, encryptionKey: Uint8Array): Promise<T> {
  const expenseTitleLooksEncrypted = looksEncrypted(expense.title)
  const expenseLooksEncrypted =
    expenseTitleLooksEncrypted &&
    ((typeof expense.amount === 'string' && looksEncrypted(expense.amount)) ||
      Boolean(expense.notes && looksEncrypted(expense.notes)) ||
      (typeof expense.categoryId === 'string' &&
        looksEncrypted(expense.categoryId)) ||
      (typeof expense.originalAmount === 'string' &&
        looksEncrypted(expense.originalAmount)) ||
      Boolean(
        expense.originalCurrency && looksEncrypted(expense.originalCurrency),
      ) ||
      Boolean(
        expense.paidFor?.some(
          (pf) =>
            (typeof pf.shares === 'string' && looksEncrypted(pf.shares)) ||
            (pf.participant && looksEncrypted(pf.participant.name)),
        ),
      ))

  try {
    const decryptedTitle = expenseTitleLooksEncrypted
      ? await decrypt(expense.title, encryptionKey)
      : expense.title
    const decryptedNotes =
      expense.notes && looksEncrypted(expense.notes)
        ? await decrypt(expense.notes, encryptionKey)
        : expense.notes

    // Decrypt category (Issue #19 - E2EE for categories)
    let decryptedCategoryId: number | undefined
    if (expense.categoryId !== undefined) {
      if (
        typeof expense.categoryId === 'string' &&
        looksEncrypted(expense.categoryId)
      ) {
        decryptedCategoryId = await decryptNumber(
          expense.categoryId,
          encryptionKey,
        )
      } else if (typeof expense.categoryId === 'string') {
        // Legacy: plain number as string (e.g., "0", "1")
        decryptedCategoryId = parseInt(expense.categoryId, 10)
      } else {
        // Legacy: plain number
        decryptedCategoryId = expense.categoryId
      }
    }

    // Decrypt amount
    let decryptedAmount: number
    if (typeof expense.amount === 'string' && looksEncrypted(expense.amount)) {
      decryptedAmount = await decryptNumber(expense.amount, encryptionKey)
    } else if (typeof expense.amount === 'string') {
      decryptedAmount = parseFloat(expense.amount)
    } else {
      decryptedAmount = expense.amount
    }

    // Decrypt originalAmount if present
    let decryptedOriginalAmount: number | null = null
    if (
      expense.originalAmount !== undefined &&
      expense.originalAmount !== null
    ) {
      if (
        typeof expense.originalAmount === 'string' &&
        looksEncrypted(expense.originalAmount)
      ) {
        decryptedOriginalAmount = await decryptNumber(
          expense.originalAmount,
          encryptionKey,
        )
      } else if (typeof expense.originalAmount === 'string') {
        decryptedOriginalAmount = parseFloat(expense.originalAmount)
      } else {
        decryptedOriginalAmount = expense.originalAmount
      }
    }

    // Decrypt originalCurrency if present (Issue #22 - E2EE for currency)
    let decryptedOriginalCurrency: string | null = null
    if (expense.originalCurrency) {
      decryptedOriginalCurrency = looksEncrypted(expense.originalCurrency)
        ? await decrypt(expense.originalCurrency, encryptionKey)
        : expense.originalCurrency
    }

    const result: Record<string, unknown> = {
      ...expense,
      title: decryptedTitle,
      notes: decryptedNotes,
      categoryId: decryptedCategoryId,
      amount: decryptedAmount,
      originalAmount: decryptedOriginalAmount,
      originalCurrency: decryptedOriginalCurrency,
    }

    // Decrypt paidBy participant name if present
    const paidBy = (expense as Record<string, unknown>).paidBy as
      | { id: string; name: string }
      | undefined
    if (
      paidBy &&
      typeof paidBy === 'object' &&
      'name' in paidBy &&
      looksEncrypted(paidBy.name)
    ) {
      result.paidBy = {
        ...paidBy,
        name: await decrypt(paidBy.name, encryptionKey),
      }
    }

    // Decrypt paidFor shares and participant names if present
    const paidFor = expense.paidFor
    if (paidFor && Array.isArray(paidFor)) {
      result.paidFor = await Promise.all(
        paidFor.map(async (pf) => {
          // Decrypt shares
          let decryptedShares: number
          if (typeof pf.shares === 'string' && looksEncrypted(pf.shares)) {
            decryptedShares = await decryptNumber(pf.shares, encryptionKey)
          } else if (typeof pf.shares === 'string') {
            decryptedShares = parseFloat(pf.shares)
          } else {
            decryptedShares = pf.shares
          }

          // Decrypt participant name if present
          let decryptedParticipant = pf.participant
          if (pf.participant && looksEncrypted(pf.participant.name)) {
            decryptedParticipant = {
              ...pf.participant,
              name: await decrypt(pf.participant.name, encryptionKey),
            }
          }

          return {
            ...pf,
            shares: decryptedShares,
            participant: decryptedParticipant,
          }
        }),
      )
    }

    return result as T
  } catch (error) {
    if (expenseLooksEncrypted) {
      throw new EncryptedDataDecryptionError('expense', error)
    }

    // If decryption fails, return original data (might be unencrypted legacy data)
    // Note: Don't log error details as they may contain sensitive information
    console.warn(
      'Expense decryption failed - returning original data (may be legacy unencrypted)',
    )
    return expense
  }
}

/**
 * Decrypt multiple expenses
 */
export async function decryptExpenses<
  T extends {
    title: string
    notes?: string | null
    categoryId?: string | number
    amount: string | number
    originalAmount?: string | number | null
    originalCurrency?: string | null
    paidFor?: Array<{
      shares: string | number
      participant?: { id: string; name: string }
    }>
  },
>(expenses: T[], encryptionKey: Uint8Array): Promise<T[]> {
  return Promise.all(expenses.map((e) => decryptExpense(e, encryptionKey)))
}

/**
 * Decrypt activity data
 */
export async function decryptActivity<
  T extends {
    data: string | null
  },
>(activity: T, encryptionKey: Uint8Array): Promise<T> {
  if (!activity.data || !looksEncrypted(activity.data)) {
    return activity
  }

  try {
    const decryptedData = await decrypt(activity.data, encryptionKey)
    return {
      ...activity,
      data: decryptedData,
    }
  } catch (error) {
    throw new EncryptedDataDecryptionError('activity', error)
  }
}

/**
 * Decrypt multiple activities
 */
export async function decryptActivities<
  T extends {
    data: string | null
  },
>(activities: T[], encryptionKey: Uint8Array): Promise<T[]> {
  return Promise.all(activities.map((a) => decryptActivity(a, encryptionKey)))
}
