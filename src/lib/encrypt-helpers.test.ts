/**
 * @jest-environment jsdom
 */

import { encrypt, generateMasterKey } from './crypto'
import {
  decryptExpense,
  decryptExpenses,
  decryptGroup,
  encryptExpenseFormValues,
  encryptGroupFormValues,
  looksEncrypted,
} from './encrypt-helpers'

describe('encrypt-helpers', () => {
  describe('looksEncrypted', () => {
    it('should return true for encrypted-looking data', () => {
      expect(looksEncrypted('abcdefghijklmnopqrstuvwxyz')).toBe(true)
      expect(looksEncrypted('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe(true)
      expect(looksEncrypted('0123456789-_ABCDEFabcdef')).toBe(true)
    })

    it('should return false for short strings', () => {
      expect(looksEncrypted('short')).toBe(false)
      expect(looksEncrypted('')).toBe(false)
    })

    it('should return false for strings with invalid characters', () => {
      expect(looksEncrypted('this has spaces and is long enough')).toBe(false)
      expect(looksEncrypted('has+plus+signs+and+is+long')).toBe(false)
    })

    it('should return true for actual encrypted data', async () => {
      const key = generateMasterKey()
      const encrypted = await encrypt('test data', key)
      expect(looksEncrypted(encrypted)).toBe(true)
    })
  })

  describe('encryptGroupFormValues and decryptGroup', () => {
    it('should encrypt and decrypt group form values', async () => {
      const key = generateMasterKey()
      const groupFormValues = {
        name: 'Test Group',
        information: 'Some information about the group',
        currency: '$',
        currencyCode: 'USD',
        participants: [
          { id: '1', name: 'Alice' },
          { id: '2', name: 'Bob' },
        ],
      }

      const encrypted = await encryptGroupFormValues(groupFormValues, key)

      // Check that values are encrypted (not readable)
      expect(encrypted.name).not.toBe(groupFormValues.name)
      expect(encrypted.information).not.toBe(groupFormValues.information)
      expect(encrypted.participants[0].name).not.toBe('Alice')
      expect(encrypted.participants[1].name).not.toBe('Bob')

      // Check that currency values are encrypted (Issue #22)
      expect(encrypted.currency).not.toBe(groupFormValues.currency)
      expect(encrypted.currencyCode).not.toBe(groupFormValues.currencyCode)
      expect(looksEncrypted(encrypted.currency)).toBe(true)
      expect(looksEncrypted(encrypted.currencyCode!)).toBe(true)

      // Decrypt and verify
      const groupData = {
        id: 'test-id',
        ...encrypted,
        information: encrypted.information || null,
        currencyCode: encrypted.currencyCode || null,
        participants: encrypted.participants.map((p, i) => ({
          id: p.id || `${i + 1}`,
          name: p.name,
        })),
      }

      const decrypted = await decryptGroup(groupData, key)

      expect(decrypted.name).toBe(groupFormValues.name)
      expect(decrypted.information).toBe(groupFormValues.information)
      expect(decrypted.currency).toBe('$')
      expect(decrypted.currencyCode).toBe('USD')
      expect(decrypted.participants[0].name).toBe('Alice')
      expect(decrypted.participants[1].name).toBe('Bob')
    })

    it('should handle group without information', async () => {
      const key = generateMasterKey()
      const groupFormValues = {
        name: 'Minimal Group',
        currency: '€',
        currencyCode: 'EUR',
        participants: [{ name: 'Solo' }],
      }

      const encrypted = await encryptGroupFormValues(groupFormValues, key)
      expect(encrypted.information).toBeUndefined()

      // Currency should still be encrypted (Issue #22)
      expect(encrypted.currency).not.toBe('€')
      expect(looksEncrypted(encrypted.currency)).toBe(true)

      const groupData = {
        id: 'test-id',
        name: encrypted.name,
        information: null,
        currency: encrypted.currency,
        currencyCode: encrypted.currencyCode || null,
        participants: encrypted.participants.map((p, i) => ({
          id: `${i + 1}`,
          name: p.name,
        })),
      }

      const decrypted = await decryptGroup(groupData, key)
      expect(decrypted.name).toBe('Minimal Group')
      expect(decrypted.information).toBeNull()
      expect(decrypted.currency).toBe('€')
      expect(decrypted.currencyCode).toBe('EUR')
    })

    it('should handle group without currencyCode (Issue #22)', async () => {
      const key = generateMasterKey()
      const groupFormValues = {
        name: 'Group without currencyCode',
        currency: '¥',
        participants: [{ name: 'Test' }],
      }

      const encrypted = await encryptGroupFormValues(groupFormValues, key)
      expect(encrypted.currencyCode).toBeNull()

      const groupData = {
        id: 'test-id',
        name: encrypted.name,
        information: null,
        currency: encrypted.currency,
        currencyCode: null,
        participants: encrypted.participants.map((p, i) => ({
          id: `${i + 1}`,
          name: p.name,
        })),
      }

      const decrypted = await decryptGroup(groupData, key)
      expect(decrypted.currency).toBe('¥')
      expect(decrypted.currencyCode).toBeNull()
    })
  })

  describe('encryptExpenseFormValues and decryptExpense', () => {
    it('should encrypt and decrypt expense form values', async () => {
      const key = generateMasterKey()
      // Use minimal type that matches what encryptExpenseFormValues expects
      const expenseFormValues = {
        title: 'Dinner',
        notes: 'Great restaurant',
        amount: 50,
        expenseDate: new Date('2024-01-15'),
        category: 1,
        splitMode: 'EVENLY' as const,
        paidFor: [] as { participant: string; shares: number }[],
        paidBy: '1',
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        recurrenceRule: 'NONE' as const,
      }

      const encrypted = await encryptExpenseFormValues(expenseFormValues, key)

      // Check that sensitive values are encrypted
      expect(encrypted.title).not.toBe(expenseFormValues.title)
      expect(encrypted.notes).not.toBe(expenseFormValues.notes)
      expect(encrypted.amount).not.toBe(expenseFormValues.amount) // Amount is also encrypted
      expect(encrypted.category).not.toBe(expenseFormValues.category) // Category is also encrypted (Issue #19)

      // Decrypt and verify (use type assertion since encrypted has different paidFor structure)
      const decrypted = await decryptExpense(
        // Add categoryId for decryption (Issue #19)
        {
          ...(encrypted as unknown as Parameters<typeof decryptExpense>[0]),
          categoryId: encrypted.category,
        },
        key,
      )
      expect(decrypted.title).toBe('Dinner')
      expect(decrypted.notes).toBe('Great restaurant')
      expect(decrypted.amount).toBe(50)
      expect(decrypted.categoryId).toBe(1) // Category is decrypted back to number (Issue #19)
    })

    it('should handle expense without notes', async () => {
      const key = generateMasterKey()
      const expenseFormValues = {
        title: 'Coffee',
        amount: 5,
        expenseDate: new Date('2024-01-15'),
        category: 1,
        splitMode: 'EVENLY' as const,
        paidFor: [] as { participant: string; shares: number }[],
        paidBy: '1',
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        recurrenceRule: 'NONE' as const,
      }

      const encrypted = await encryptExpenseFormValues(expenseFormValues, key)
      expect(encrypted.notes).toBeUndefined()

      const decrypted = await decryptExpense(
        encrypted as unknown as Parameters<typeof decryptExpense>[0],
        key,
      )
      expect(decrypted.title).toBe('Coffee')
      expect(decrypted.notes).toBeUndefined()
    })
  })

  describe('decryptExpenses', () => {
    it('should decrypt multiple expenses', async () => {
      const key = generateMasterKey()

      const expenses = [
        { title: await encrypt('Expense 1', key), notes: null, amount: 100 },
        {
          title: await encrypt('Expense 2', key),
          notes: await encrypt('Note', key),
          amount: 200,
        },
        {
          title: await encrypt('Expense 3', key),
          notes: undefined,
          amount: 300,
        },
      ]

      const decrypted = await decryptExpenses(expenses, key)

      expect(decrypted[0].title).toBe('Expense 1')
      expect(decrypted[1].title).toBe('Expense 2')
      expect(decrypted[1].notes).toBe('Note')
      expect(decrypted[2].title).toBe('Expense 3')
    })
  })

  describe('category encryption (Issue #19)', () => {
    it('should encrypt and decrypt category', async () => {
      const key = generateMasterKey()
      const expenseFormValues = {
        title: 'Groceries',
        amount: 100,
        expenseDate: new Date('2024-01-15'),
        category: 9, // Groceries category
        splitMode: 'EVENLY' as const,
        paidFor: [] as { participant: string; shares: number }[],
        paidBy: '1',
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        recurrenceRule: 'NONE' as const,
      }

      const encrypted = await encryptExpenseFormValues(expenseFormValues, key)

      // Category should be encrypted (not equal to original number)
      expect(encrypted.category).not.toBe(expenseFormValues.category)
      expect(typeof encrypted.category).toBe('string')

      // Decrypt with categoryId field
      const decrypted = await decryptExpense(
        {
          title: encrypted.title,
          amount: encrypted.amount,
          categoryId: encrypted.category as unknown as string,
        },
        key,
      )

      // Category should be decrypted back to original number
      expect(decrypted.categoryId).toBe(9)
    })

    it('should handle all category IDs (0-42)', async () => {
      const key = generateMasterKey()

      // Test a few category IDs from different groupings
      const categoryIds = [0, 8, 17, 25, 35, 42]

      for (const categoryId of categoryIds) {
        const expenseFormValues = {
          title: 'Test',
          amount: 10,
          expenseDate: new Date('2024-01-15'),
          category: categoryId,
          splitMode: 'EVENLY' as const,
          paidFor: [] as { participant: string; shares: number }[],
          paidBy: '1',
          isReimbursement: false,
          saveDefaultSplittingOptions: false,
          recurrenceRule: 'NONE' as const,
        }

        const encrypted = await encryptExpenseFormValues(expenseFormValues, key)
        const decrypted = await decryptExpense(
          {
            title: encrypted.title,
            amount: encrypted.amount,
            categoryId: encrypted.category as unknown as string,
          },
          key,
        )

        expect(decrypted.categoryId).toBe(categoryId)
      }
    })
  })

  describe('currency encryption (Issue #22)', () => {
    it('should encrypt and decrypt originalCurrency', async () => {
      const key = generateMasterKey()
      const expenseFormValues = {
        title: 'International Purchase',
        amount: 100,
        expenseDate: new Date('2024-01-15'),
        category: 0,
        splitMode: 'EVENLY' as const,
        paidFor: [] as { participant: string; shares: number }[],
        paidBy: '1',
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        recurrenceRule: 'NONE' as const,
        originalCurrency: 'EUR',
        originalAmount: 90,
      }

      const encrypted = await encryptExpenseFormValues(expenseFormValues, key)

      // originalCurrency should be encrypted
      expect(encrypted.originalCurrency).not.toBe('EUR')
      expect(looksEncrypted(encrypted.originalCurrency!)).toBe(true)

      // Decrypt and verify
      const decrypted = await decryptExpense(
        {
          title: encrypted.title,
          amount: encrypted.amount,
          originalCurrency: encrypted.originalCurrency,
          originalAmount: encrypted.originalAmount,
        },
        key,
      )

      expect(decrypted.originalCurrency).toBe('EUR')
    })

    it('should handle expense without originalCurrency', async () => {
      const key = generateMasterKey()
      const expenseFormValues = {
        title: 'Local Purchase',
        amount: 50,
        expenseDate: new Date('2024-01-15'),
        category: 0,
        splitMode: 'EVENLY' as const,
        paidFor: [] as { participant: string; shares: number }[],
        paidBy: '1',
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        recurrenceRule: 'NONE' as const,
      }

      const encrypted = await encryptExpenseFormValues(expenseFormValues, key)
      expect(encrypted.originalCurrency).toBeUndefined()

      const decrypted = await decryptExpense(
        {
          title: encrypted.title,
          amount: encrypted.amount,
          originalCurrency: null,
        },
        key,
      )

      expect(decrypted.originalCurrency).toBeNull()
    })

    it('should handle various currency symbols and codes', async () => {
      const key = generateMasterKey()
      const currencies = ['$', '€', '¥', '£', '₩', 'USD', 'EUR', 'JPY', 'GBP']

      for (const currency of currencies) {
        const groupFormValues = {
          name: 'Test',
          currency: currency,
          participants: [{ name: 'Test' }],
        }

        const encrypted = await encryptGroupFormValues(groupFormValues, key)
        expect(looksEncrypted(encrypted.currency)).toBe(true)

        const groupData = {
          id: 'test-id',
          name: encrypted.name,
          information: null,
          currency: encrypted.currency,
          currencyCode: null,
          participants: encrypted.participants.map((p, i) => ({
            id: `${i + 1}`,
            name: p.name,
          })),
        }

        const decrypted = await decryptGroup(groupData, key)
        expect(decrypted.currency).toBe(currency)
      }
    })
  })

  describe('backward compatibility', () => {
    it('should handle unencrypted legacy data', async () => {
      const key = generateMasterKey()

      // Simulate unencrypted legacy expense
      const legacyExpense = {
        title: 'Plain text title',
        notes: 'Plain text notes',
        amount: 50,
      }

      const decrypted = await decryptExpense(legacyExpense, key)

      // Should return original data since decryption fails
      expect(decrypted.title).toBe('Plain text title')
      expect(decrypted.notes).toBe('Plain text notes')
      expect(decrypted.amount).toBe(50)
    })

    it('should handle legacy categoryId as plain number', async () => {
      const key = generateMasterKey()

      // Simulate legacy expense with plain categoryId (number)
      const legacyExpense = {
        title: 'Plain text title',
        amount: 50,
        categoryId: 5, // Plain number (legacy format)
      }

      const decrypted = await decryptExpense(legacyExpense, key)

      // Should preserve categoryId as number
      expect(decrypted.categoryId).toBe(5)
    })

    it('should handle legacy categoryId as plain string', async () => {
      const key = generateMasterKey()

      // Simulate legacy expense with plain categoryId string (e.g., from DB conversion)
      const legacyExpense = {
        title: 'Plain text title',
        amount: 50,
        categoryId: '10', // Plain number as string (legacy format)
      }

      const decrypted = await decryptExpense(legacyExpense, key)

      // Should parse and return as number
      expect(decrypted.categoryId).toBe(10)
    })

    it('should handle legacy unencrypted currency (Issue #22)', async () => {
      const key = generateMasterKey()

      // Simulate legacy group with unencrypted currency
      const legacyGroup = {
        id: 'test-id',
        name: 'Test Group', // Plain text (not encrypted)
        information: null,
        currency: '$', // Plain currency symbol (legacy)
        currencyCode: 'USD', // Plain currency code (legacy)
        participants: [{ id: '1', name: 'Alice' }], // Plain text
      }

      const decrypted = await decryptGroup(legacyGroup, key)

      // Should return original data since decryption fails
      expect(decrypted.currency).toBe('$')
      expect(decrypted.currencyCode).toBe('USD')
    })

    it('should handle legacy unencrypted originalCurrency (Issue #22)', async () => {
      const key = generateMasterKey()

      // Simulate legacy expense with unencrypted originalCurrency
      const legacyExpense = {
        title: 'Plain text title',
        amount: 50,
        originalCurrency: 'EUR', // Plain currency code (legacy)
      }

      const decrypted = await decryptExpense(legacyExpense, key)

      // Should return original data since it's not encrypted
      expect(decrypted.originalCurrency).toBe('EUR')
    })
  })
})
