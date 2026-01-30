import { RecurrenceRule, SplitMode } from '@prisma/client'
import Decimal from 'decimal.js'

import * as z from 'zod'

export const groupFormSchema = z
  .object({
    name: z.string().min(2, 'min2').max(50, 'max50'),
    information: z.string().optional(),
    // Currency fields can be encrypted strings (Issue #22)
    currency: z.string().min(1, 'min1'), // No max - encrypted strings are longer
    currencyCode: z.union([z.string().nullish(), z.literal('')]), // ISO-4217 code or encrypted string
    participants: z
      .array(
        z.object({
          id: z.string().optional(),
          name: z.string().min(2, 'min2').max(50, 'max50'),
        }),
      )
      .min(1)
      .max(500),
    // Password protection (Issue #2)
    password: z.string().optional(), // Used only during creation, not stored
    passwordHint: z.string().max(100, 'max100').optional(),
    passwordSalt: z.string().optional(), // Base64 encoded salt, stored in DB
  })
  .superRefine(({ participants }, ctx) => {
    participants.forEach((participant, i) => {
      participants.slice(0, i).forEach((otherParticipant) => {
        if (otherParticipant.name === participant.name) {
          ctx.addIssue({
            code: 'custom',
            message: 'duplicateParticipantName',
            path: ['participants', i, 'name'],
          })
        }
      })
    })
  })

export type GroupFormValues = z.infer<typeof groupFormSchema>

const inputCoercedToNumber = z.union([
  z.number(),
  z.string().transform((value, ctx) => {
    const valueAsNumber = Number(value)
    if (Number.isNaN(valueAsNumber))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'invalidNumber',
      })
    return valueAsNumber
  }),
])

// For encrypted amounts - accepts either a number or an encrypted string
// Validation is done before encryption, so we just pass through the value
const encryptableNumber = z.union([
  z.number(),
  z.string(), // Encrypted string or numeric string
])

export const expenseFormSchema = z
  .object({
    expenseDate: z.coerce.date(),
    title: z.string({ required_error: 'titleRequired' }).min(2, 'min2'),
    // Category can be number (form input) or encrypted string (Issue #19 - E2EE)
    category: z.union([z.number(), z.string()]).default(0),
    amount: z
      .union(
        [
          z.number(),
          z.string(), // Can be encrypted string or numeric string
        ],
        { required_error: 'amountRequired' },
      )
      .refine((amount) => {
        // Skip validation for encrypted strings (they start with special chars and are long)
        if (
          typeof amount === 'string' &&
          (amount.length > 20 || isNaN(Number(amount)))
        )
          return true
        const numAmount = typeof amount === 'string' ? Number(amount) : amount
        return numAmount != 0
      }, 'amountNotZero')
      .refine((amount) => {
        if (
          typeof amount === 'string' &&
          (amount.length > 20 || isNaN(Number(amount)))
        )
          return true
        const numAmount = typeof amount === 'string' ? Number(amount) : amount
        return numAmount <= 10_000_000_00
      }, 'amountTenMillion'),
    originalAmount: z
      .union([
        z.literal('').transform(() => undefined),
        z.number(),
        z.string(), // Can be encrypted
      ])
      .optional()
      .refine((amount) => {
        if (amount === undefined || amount === '') return true
        if (
          typeof amount === 'string' &&
          (amount.length > 20 || isNaN(Number(amount)))
        )
          return true
        const numAmount = typeof amount === 'string' ? Number(amount) : amount
        return numAmount != 0
      }, 'amountNotZero')
      .refine((amount) => {
        if (amount === undefined || amount === '') return true
        if (
          typeof amount === 'string' &&
          (amount.length > 20 || isNaN(Number(amount)))
        )
          return true
        const numAmount = typeof amount === 'string' ? Number(amount) : amount
        return numAmount <= 10_000_000_00
      }, 'amountTenMillion'),
    // Can be 3-char currency code (plain) or encrypted string (Issue #22 - E2EE)
    originalCurrency: z.union([z.string().max(500).nullish(), z.literal('')]),
    conversionRate: z
      .union([
        z.literal('').transform(() => undefined),
        inputCoercedToNumber.refine((amount) => amount > 0, 'ratePositive'),
      ])
      .optional(),
    paidBy: z.string({ required_error: 'paidByRequired' }),
    paidFor: z
      .array(
        z.object({
          participant: z.string(),
          originalAmount: z.string().optional(), // For converting shares by amounts in original currency, not saved.
          shares: z.union([
            z.number(),
            z.string(), // Can be encrypted string or numeric string
          ]),
        }),
      )
      .min(1, 'paidForMin1')
      .max(500)
      .superRefine((paidFor, ctx) => {
        for (const { shares } of paidFor) {
          // Skip validation for encrypted strings (long and not parseable as numbers)
          if (
            typeof shares === 'string' &&
            (shares.length > 20 || isNaN(Number(shares.replace(/,/g, '.'))))
          ) {
            continue
          }
          const shareNumber =
            typeof shares === 'string'
              ? Number(shares.replace(/,/g, '.'))
              : Number(shares)
          if (shareNumber <= 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'noZeroShares',
            })
          }
        }
      }),
    splitMode: z
      .enum<
        SplitMode,
        [SplitMode, ...SplitMode[]]
      >(Object.values(SplitMode) as any)
      .default('EVENLY'),
    saveDefaultSplittingOptions: z.boolean(),
    isReimbursement: z.boolean(),
    documents: z
      .array(
        z.object({
          id: z.string(),
          url: z.string().url(),
          width: z.number().int().min(1).max(10000),
          height: z.number().int().min(1).max(10000),
        }),
      )
      .max(100)
      .default([]),
    notes: z.string().optional(),
    recurrenceRule: z
      .enum<
        RecurrenceRule,
        [RecurrenceRule, ...RecurrenceRule[]]
      >(Object.values(RecurrenceRule) as any)
      .default('NONE'),
  })
  .superRefine((expense, ctx) => {
    // Helper to check if a value looks encrypted (long string that's not a valid number)
    const isEncrypted = (val: string | number) =>
      typeof val === 'string' &&
      (val.length > 20 || isNaN(Number(val.replace(/,/g, '.'))))

    // Skip validation if amounts are encrypted
    const amountIsEncrypted = isEncrypted(expense.amount)
    const sharesAreEncrypted = expense.paidFor.some((pf) =>
      isEncrypted(pf.shares),
    )

    if (amountIsEncrypted || sharesAreEncrypted) {
      return // Skip numeric validations for encrypted data
    }

    switch (expense.splitMode) {
      case 'EVENLY':
        break // noop
      case 'BY_SHARES':
        break // noop
      case 'BY_AMOUNT': {
        const sum = expense.paidFor.reduce(
          (sum, { shares }) => new Decimal(shares).add(sum),
          new Decimal(0),
        )
        if (!sum.equals(new Decimal(expense.amount))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'amountSum',
            path: ['paidFor'],
          })
        }
        break
      }
      case 'BY_PERCENTAGE': {
        const sum = expense.paidFor.reduce(
          (sum, { shares }) =>
            sum +
            (typeof shares === 'string'
              ? Math.round(Number(shares) * 100)
              : Number(shares)),
          0,
        )
        if (sum !== 10000) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'percentageSum',
            path: ['paidFor'],
          })
        }
        break
      }
    }
  })
  .transform((expense) => {
    // Helper to check if a value looks encrypted
    const isEncrypted = (val: string | number) =>
      typeof val === 'string' &&
      (val.length > 20 || isNaN(Number(val.replace(/,/g, '.'))))

    // If data is encrypted, don't transform - keep as-is for storage
    const amountIsEncrypted = isEncrypted(expense.amount)
    if (amountIsEncrypted) {
      return expense // Return encrypted data unchanged
    }

    // Format the share split as a number (if from form submission)
    return {
      ...expense,
      paidFor: expense.paidFor.map((paidFor) => {
        const shares = paidFor.shares
        // Skip transformation for encrypted shares
        if (isEncrypted(shares)) {
          return paidFor
        }
        if (typeof shares === 'string' && expense.splitMode !== 'BY_AMOUNT') {
          // For splitting not by amount, preserve the previous behaviour of multiplying the share by 100
          return {
            ...paidFor,
            shares: Math.round(Number(shares) * 100),
          }
        }
        // Otherwise, no need as the number will have been formatted according to currency.
        return {
          ...paidFor,
          shares: Number(shares),
        }
      }),
    }
  })

export type ExpenseFormValues = z.infer<typeof expenseFormSchema>

export type SplittingOptions = {
  // Used for saving default splitting options in localStorage
  splitMode: SplitMode
  paidFor: ExpenseFormValues['paidFor'] | null
}
