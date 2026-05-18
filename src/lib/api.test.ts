/**
 * API data access layer tests (Issue #96)
 *
 * These tests verify the data access functions in api.ts.
 * Note: These are unit tests that mock Prisma - integration tests would require a real database.
 */

// Mock Prisma before importing modules that use it
jest.mock('./prisma', () => ({
  prisma: {
    group: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    expense: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    activity: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    category: {
      findMany: jest.fn(),
    },
    recurringExpenseLink: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}))

// Mock nanoid
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id-12345'),
}))

import { ActivityType } from '@prisma/client'
import {
  createGroup,
  createRecurringExpenses,
  deleteGroup,
  getActivities,
  getCategories,
  getExpense,
  getGroup,
  getGroupExpenses,
  getGroups,
  logActivity,
  permanentlyDeleteGroup,
  randomId,
  restoreGroup,
} from './api'
import { prisma } from './prisma'

// Get typed mock references
const mockGroup = prisma.group as jest.Mocked<typeof prisma.group>
const mockExpense = prisma.expense as jest.Mocked<typeof prisma.expense>
const mockActivity = prisma.activity as jest.Mocked<typeof prisma.activity>
const mockCategory = prisma.category as jest.Mocked<typeof prisma.category>
const mockRecurringExpenseLink = prisma.recurringExpenseLink as jest.Mocked<
  typeof prisma.recurringExpenseLink
>

describe('API data access layer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('randomId', () => {
    it('should return a string ID', () => {
      const id = randomId()
      expect(typeof id).toBe('string')
      expect(id).toBe('mock-id-12345')
    })
  })

  describe('createGroup', () => {
    it('should create a group with participants', async () => {
      const mockCreatedGroup = {
        id: 'mock-id-12345',
        name: 'Test Group',
        information: 'Test info',
        currency: '$',
        currencyCode: 'USD',
        passwordSalt: null,
        passwordHint: null,
        participants: [{ id: 'mock-id-12345', name: 'Alice' }],
        createdAt: new Date(),
        deletedAt: null,
      }
      ;(mockGroup.create as jest.Mock).mockResolvedValue(mockCreatedGroup)

      const result = await createGroup({
        name: 'Test Group',
        information: 'Test info',
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Alice' }],
      })

      expect(result).toEqual(mockCreatedGroup)
      expect(mockGroup.create).toHaveBeenCalledWith({
        data: {
          id: 'mock-id-12345',
          name: 'Test Group',
          information: 'Test info',
          currency: '$',
          currencyCode: 'USD',
          passwordSalt: undefined,
          passwordHint: undefined,
          participants: {
            createMany: {
              data: [{ id: 'mock-id-12345', name: 'Alice' }],
            },
          },
        },
        include: { participants: true },
      })
    })

    it('should create a password-protected group', async () => {
      const mockCreatedGroup = {
        id: 'mock-id-12345',
        name: 'Protected Group',
        passwordSalt: 'salt123',
        passwordHint: 'hint',
        participants: [],
        createdAt: new Date(),
        deletedAt: null,
      }
      ;(mockGroup.create as jest.Mock).mockResolvedValue(mockCreatedGroup)

      await createGroup({
        name: 'Protected Group',
        currency: '$',
        participants: [],
        passwordSalt: 'salt123',
        passwordHint: 'hint',
      })

      expect(mockGroup.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            passwordSalt: 'salt123',
            passwordHint: 'hint',
          }),
        }),
      )
    })
  })

  describe('getGroup', () => {
    it('should return a group with participants', async () => {
      const mockFoundGroup = {
        id: 'group-1',
        name: 'Test Group',
        participants: [{ id: 'p1', name: 'Alice' }],
      }
      ;(mockGroup.findUnique as jest.Mock).mockResolvedValue(mockFoundGroup)

      const result = await getGroup('group-1')

      expect(result).toEqual(mockFoundGroup)
      expect(mockGroup.findUnique).toHaveBeenCalledWith({
        where: { id: 'group-1' },
        include: { participants: true },
      })
    })

    it('should return null for non-existent group', async () => {
      ;(mockGroup.findUnique as jest.Mock).mockResolvedValue(null)

      const result = await getGroup('non-existent')

      expect(result).toBeNull()
    })
  })

  describe('getGroups', () => {
    it('should return multiple groups with participant counts', async () => {
      const now = new Date()
      const mockFoundGroups = [
        {
          id: 'g1',
          name: 'Group 1',
          createdAt: now,
          deletedAt: null,
          _count: { participants: 3 },
        },
        {
          id: 'g2',
          name: 'Group 2',
          createdAt: now,
          deletedAt: now,
          _count: { participants: 2 },
        },
      ]
      ;(mockGroup.findMany as jest.Mock).mockResolvedValue(mockFoundGroups)

      const result = await getGroups(['g1', 'g2'])

      expect(result).toHaveLength(2)
      expect(result[0].createdAt).toBe(now.toISOString())
      expect(result[1].deletedAt).toBe(now.toISOString())
      expect(mockGroup.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['g1', 'g2'] } },
        include: { _count: { select: { participants: true } } },
      })
    })

    it('should return empty array for no matching groups', async () => {
      ;(mockGroup.findMany as jest.Mock).mockResolvedValue([])

      const result = await getGroups([])

      expect(result).toEqual([])
    })
  })

  describe('deleteGroup', () => {
    it('should soft-delete a group', async () => {
      const mockFoundGroup = { id: 'group-1', name: 'Test' }
      ;(mockGroup.findUnique as jest.Mock).mockResolvedValue(mockFoundGroup)
      ;(mockGroup.update as jest.Mock).mockResolvedValue({
        ...mockFoundGroup,
        deletedAt: new Date(),
      })

      await deleteGroup('group-1')

      expect(mockGroup.update).toHaveBeenCalledWith({
        where: { id: 'group-1' },
        data: { deletedAt: expect.any(Date) },
      })
    })

    it('should throw error for non-existent group', async () => {
      ;(mockGroup.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(deleteGroup('non-existent')).rejects.toThrow(
        'Invalid group ID',
      )
    })
  })

  describe('restoreGroup', () => {
    it('should restore a deleted group', async () => {
      const mockDeletedGroup = {
        id: 'group-1',
        deletedAt: new Date(),
      }
      ;(mockGroup.findUnique as jest.Mock).mockResolvedValue(mockDeletedGroup)
      ;(mockGroup.update as jest.Mock).mockResolvedValue({
        ...mockDeletedGroup,
        deletedAt: null,
      })

      await restoreGroup('group-1')

      expect(mockGroup.update).toHaveBeenCalledWith({
        where: { id: 'group-1' },
        data: { deletedAt: null },
      })
    })

    it('should throw error for non-existent group', async () => {
      ;(mockGroup.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(restoreGroup('non-existent')).rejects.toThrow(
        'Invalid group ID',
      )
    })

    it('should throw error for non-deleted group', async () => {
      ;(mockGroup.findUnique as jest.Mock).mockResolvedValue({
        id: 'group-1',
        deletedAt: null,
      })

      await expect(restoreGroup('group-1')).rejects.toThrow(
        'Group is not deleted',
      )
    })
  })

  describe('permanentlyDeleteGroup', () => {
    it('should permanently delete a group', async () => {
      ;(mockGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group-1' })
      ;(mockGroup.delete as jest.Mock).mockResolvedValue({ id: 'group-1' })

      await permanentlyDeleteGroup('group-1')

      expect(mockGroup.delete).toHaveBeenCalledWith({
        where: { id: 'group-1' },
      })
    })

    it('should throw error for non-existent group', async () => {
      ;(mockGroup.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(permanentlyDeleteGroup('non-existent')).rejects.toThrow(
        'Invalid group ID',
      )
    })
  })

  describe('getExpense', () => {
    it('should return expense with related data', async () => {
      const mockFoundExpense = {
        id: 'expense-1',
        groupId: 'group-1',
        title: 'Dinner',
        amount: '1000',
        paidBy: { id: 'p1', name: 'Alice' },
        paidFor: [{ participantId: 'p2', shares: '500' }],
        recurringExpenseLink: null,
      }
      ;(mockExpense.findFirst as jest.Mock).mockResolvedValue(mockFoundExpense)

      const result = await getExpense('group-1', 'expense-1')

      expect(result).toEqual(mockFoundExpense)
      expect(mockExpense.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'expense-1',
          groupId: 'group-1',
        },
        include: {
          paidBy: true,
          paidFor: true,
          recurringExpenseLink: true,
        },
      })
    })

    it('should return null for expense in wrong group (Issue #47)', async () => {
      ;(mockExpense.findFirst as jest.Mock).mockResolvedValue(null)

      const result = await getExpense('wrong-group', 'expense-1')

      expect(result).toBeNull()
    })
  })

  describe('getGroupExpenses', () => {
    it('should return expenses for a group', async () => {
      const mockExpenses = [
        {
          id: 'e1',
          title: 'Dinner',
          amount: '1000',
          paidBy: { id: 'p1', name: 'Alice' },
          paidFor: [],
        },
      ]
      ;(mockRecurringExpenseLink.findMany as jest.Mock).mockResolvedValue([])
      ;(mockExpense.findMany as jest.Mock).mockResolvedValue(mockExpenses)

      const result = await getGroupExpenses('group-1')

      expect(result).toEqual(mockExpenses)
      expect(mockExpense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { groupId: 'group-1', title: undefined },
          // `id` DESC is the stable tie-breaker required by the cursor
          // contract introduced in Issue #170.
          orderBy: [
            { expenseDate: 'desc' },
            { createdAt: 'desc' },
            { id: 'desc' },
          ],
        }),
      )
    })

    it('should support pagination options', async () => {
      ;(mockRecurringExpenseLink.findMany as jest.Mock).mockResolvedValue([])
      ;(mockExpense.findMany as jest.Mock).mockResolvedValue([])

      await getGroupExpenses('group-1', { offset: 10, length: 5 })

      expect(mockExpense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 5,
        }),
      )
    })

    it('should not apply any server-side title filter (Issue #164)', async () => {
      // Server-side filter on `title` was removed because the column stores
      // E2EE ciphertext; SQL LIKE/ILIKE on it cannot match user input and
      // leaks the plaintext search term to server logs.
      ;(mockRecurringExpenseLink.findMany as jest.Mock).mockResolvedValue([])
      ;(mockExpense.findMany as jest.Mock).mockResolvedValue([])

      await getGroupExpenses('group-1')

      expect(mockExpense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { groupId: 'group-1' },
        }),
      )
    })

    describe('cursor pagination (Issue #170)', () => {
      it('emits 3-step keyset WHERE OR clause when cursor is provided', async () => {
        ;(mockExpense.findMany as jest.Mock).mockResolvedValue([])
        const expenseDate = new Date('2026-05-10T12:00:00.000Z')
        const createdAt = new Date('2026-05-10T11:00:00.000Z')
        await getGroupExpenses('g1', {
          cursor: { expenseDate, createdAt, id: 'exp-1' },
          limit: 100,
        })
        expect(mockExpense.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              groupId: 'g1',
              OR: [
                { expenseDate: { lt: expenseDate } },
                { expenseDate, createdAt: { lt: createdAt } },
                { expenseDate, createdAt, id: { lt: 'exp-1' } },
              ],
            },
            take: 100,
            skip: undefined,
          }),
        )
      })

      it('keeps offset/length path untouched when cursor is absent', async () => {
        ;(mockExpense.findMany as jest.Mock).mockResolvedValue([])
        await getGroupExpenses('g1', { offset: 5, length: 50 })
        expect(mockExpense.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { groupId: 'g1' },
            skip: 5,
            take: 50,
          }),
        )
      })

      it('throws when offset and cursor are specified simultaneously', async () => {
        // The type-level discriminated union blocks this, but a runtime guard
        // backs it up as defence-in-depth. Cast to `never` to bypass typing.
        await expect(
          getGroupExpenses('g1', {
            offset: 0,
            length: 10,
            cursor: {
              expenseDate: new Date(),
              createdAt: new Date(),
              id: 'x',
            },
            limit: 100,
          } as never),
        ).rejects.toThrow(/simultaneously/)
      })
    })
  })

  describe('getCategories', () => {
    it('should return all categories', async () => {
      const mockCategories = [
        { id: 1, name: 'Food', grouping: 'Essentials' },
        { id: 2, name: 'Transport', grouping: 'Travel' },
      ]
      ;(mockCategory.findMany as jest.Mock).mockResolvedValue(mockCategories)

      const result = await getCategories()

      expect(result).toEqual(mockCategories)
      expect(mockCategory.findMany).toHaveBeenCalled()
    })
  })

  describe('getActivities', () => {
    it('should return activities with associated expenses', async () => {
      const mockActivities = [
        {
          id: 'a1',
          groupId: 'g1',
          activityType: 'CREATE_EXPENSE',
          expenseId: 'e1',
          data: 'Dinner',
        },
        {
          id: 'a2',
          groupId: 'g1',
          activityType: 'UPDATE_GROUP',
          expenseId: null,
          data: null,
        },
      ]
      const mockAssociatedExpenses = [{ id: 'e1', title: 'Dinner' }]

      ;(mockActivity.findMany as jest.Mock).mockResolvedValue(mockActivities)
      ;(mockExpense.findMany as jest.Mock).mockResolvedValue(
        mockAssociatedExpenses,
      )

      const result = await getActivities('g1')

      expect(result).toHaveLength(2)
      expect(result[0].expense).toEqual({ id: 'e1', title: 'Dinner' })
      expect(result[1].expense).toBeUndefined()
    })

    it('should support pagination', async () => {
      ;(mockActivity.findMany as jest.Mock).mockResolvedValue([])
      ;(mockExpense.findMany as jest.Mock).mockResolvedValue([])

      await getActivities('g1', { offset: 5, length: 10 })

      expect(mockActivity.findMany).toHaveBeenCalledWith({
        where: { groupId: 'g1' },
        orderBy: [{ time: 'desc' }],
        skip: 5,
        take: 10,
      })
    })
  })

  describe('logActivity', () => {
    it('should create an activity log entry', async () => {
      const mockCreatedActivity = {
        id: 'mock-id-12345',
        groupId: 'g1',
        activityType: ActivityType.UPDATE_GROUP,
      }
      ;(mockActivity.create as jest.Mock).mockResolvedValue(mockCreatedActivity)

      const result = await logActivity('g1', ActivityType.UPDATE_GROUP)

      expect(result).toEqual(mockCreatedActivity)
      expect(mockActivity.create).toHaveBeenCalledWith({
        data: {
          id: 'mock-id-12345',
          groupId: 'g1',
          activityType: ActivityType.UPDATE_GROUP,
        },
      })
    })

    it('should include extra fields when provided', async () => {
      ;(mockActivity.create as jest.Mock).mockResolvedValue({})

      await logActivity('g1', ActivityType.CREATE_EXPENSE, {
        participantId: 'p1',
        expenseId: 'e1',
        data: 'Dinner',
      })

      expect(mockActivity.create).toHaveBeenCalledWith({
        data: {
          id: 'mock-id-12345',
          groupId: 'g1',
          activityType: ActivityType.CREATE_EXPENSE,
          participantId: 'p1',
          expenseId: 'e1',
          data: 'Dinner',
        },
      })
    })
  })

  describe('getGroupExpenses', () => {
    it('does not trigger recurring expense generation (Issue #169)', async () => {
      ;(mockRecurringExpenseLink.findMany as jest.Mock).mockResolvedValue([])
      ;(mockExpense.findMany as jest.Mock).mockResolvedValue([])
      const mock$transaction = prisma.$transaction as jest.Mock

      await getGroupExpenses('g1')

      expect(mockRecurringExpenseLink.findMany).not.toHaveBeenCalled()
      expect(mock$transaction).not.toHaveBeenCalled()
    })
  })

  describe('createRecurringExpenses', () => {
    it('skips links whose group is soft-deleted (Issue #141)', async () => {
      ;(mockRecurringExpenseLink.findMany as jest.Mock).mockResolvedValue([])

      await createRecurringExpenses()

      expect(mockRecurringExpenseLink.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            currentFrameExpense: {
              group: { deletedAt: null },
            },
          }),
        }),
      )
    })

    it('applies the soft-delete filter even when scoped by groupId', async () => {
      ;(mockRecurringExpenseLink.findMany as jest.Mock).mockResolvedValue([])

      await createRecurringExpenses('g1')

      expect(mockRecurringExpenseLink.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            groupId: 'g1',
            currentFrameExpense: {
              group: { deletedAt: null },
            },
          }),
        }),
      )
    })

    it('does not invoke $transaction when no eligible links exist', async () => {
      ;(mockRecurringExpenseLink.findMany as jest.Mock).mockResolvedValue([])
      const mock$transaction = prisma.$transaction as jest.Mock

      await createRecurringExpenses()

      expect(mock$transaction).not.toHaveBeenCalled()
    })
  })
})
