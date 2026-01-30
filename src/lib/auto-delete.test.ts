/**
 * Auto-delete functionality tests (Issue #10)
 *
 * These tests verify the auto-delete logic for inactive groups.
 * Note: These are unit tests that mock Prisma - integration tests would require a real database.
 */

// Mock Prisma before importing modules that use it
jest.mock('./prisma', () => ({
  prisma: {
    group: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}))

import {
  autoDeleteInactiveGroups,
  cleanupExpiredGroups,
  getInactiveGroups,
} from './auto-delete'
import { prisma } from './prisma'

// Get typed mock reference
const mockGroup = prisma.group as jest.Mocked<typeof prisma.group>

describe('Auto-delete functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getInactiveGroups', () => {
    it('should return empty array when no groups exist', async () => {
      ;(mockGroup.findMany as jest.Mock).mockResolvedValue([])

      const result = await getInactiveGroups(90)

      expect(result).toEqual([])
      expect(mockGroup.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        select: {
          id: true,
          createdAt: true,
          activities: {
            orderBy: { time: 'desc' },
            take: 1,
            select: { time: true },
          },
        },
      })
    })

    it('should return inactive groups based on activity', async () => {
      const now = new Date()
      const oldDate = new Date(now)
      oldDate.setDate(oldDate.getDate() - 100) // 100 days ago

      const recentDate = new Date(now)
      recentDate.setDate(recentDate.getDate() - 10) // 10 days ago

      // Groups with their activities included in a single query
      ;(mockGroup.findMany as jest.Mock).mockResolvedValue([
        { id: 'inactive-group', createdAt: oldDate, activities: [] }, // no activity
        {
          id: 'active-group',
          createdAt: oldDate,
          activities: [{ time: recentDate }],
        }, // recent activity
      ])

      const result = await getInactiveGroups(90)

      expect(result).toEqual(['inactive-group'])
    })

    it('should use group creation date when no activity exists', async () => {
      const now = new Date()
      const oldCreationDate = new Date(now)
      oldCreationDate.setDate(oldCreationDate.getDate() - 100) // 100 days ago
      ;(mockGroup.findMany as jest.Mock).mockResolvedValue([
        { id: 'old-group', createdAt: oldCreationDate, activities: [] },
      ])

      const result = await getInactiveGroups(90)

      expect(result).toEqual(['old-group'])
    })

    it('should not include groups with recent activity', async () => {
      const now = new Date()
      const recentActivity = new Date(now)
      recentActivity.setDate(recentActivity.getDate() - 30) // 30 days ago
      ;(mockGroup.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'recent-group',
          createdAt: new Date('2020-01-01'),
          activities: [{ time: recentActivity }],
        },
      ])

      const result = await getInactiveGroups(90)

      expect(result).toEqual([])
    })
  })

  describe('autoDeleteInactiveGroups', () => {
    it('should return early when inactiveDays is 0 (disabled)', async () => {
      const result = await autoDeleteInactiveGroups(0)

      expect(result).toEqual({ softDeleted: 0, groupIds: [] })
      expect(mockGroup.findMany).not.toHaveBeenCalled()
    })

    it('should return early when inactiveDays is negative', async () => {
      const result = await autoDeleteInactiveGroups(-1)

      expect(result).toEqual({ softDeleted: 0, groupIds: [] })
      expect(mockGroup.findMany).not.toHaveBeenCalled()
    })

    it('should soft-delete inactive groups', async () => {
      const now = new Date()
      const oldDate = new Date(now)
      oldDate.setDate(oldDate.getDate() - 100)
      ;(mockGroup.findMany as jest.Mock).mockResolvedValue([
        { id: 'inactive-1', createdAt: oldDate, activities: [] },
        { id: 'inactive-2', createdAt: oldDate, activities: [] },
      ])
      ;(mockGroup.updateMany as jest.Mock).mockResolvedValue({ count: 2 })

      const result = await autoDeleteInactiveGroups(90)

      expect(result.softDeleted).toBe(2)
      expect(result.groupIds).toEqual(['inactive-1', 'inactive-2'])
      expect(mockGroup.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['inactive-1', 'inactive-2'] } },
        data: { deletedAt: expect.any(Date) },
      })
    })

    it('should return 0 when no inactive groups exist', async () => {
      ;(mockGroup.findMany as jest.Mock).mockResolvedValue([])

      const result = await autoDeleteInactiveGroups(90)

      expect(result).toEqual({ softDeleted: 0, groupIds: [] })
      expect(mockGroup.updateMany).not.toHaveBeenCalled()
    })
  })

  describe('cleanupExpiredGroups', () => {
    it('should permanently delete groups past grace period', async () => {
      ;(mockGroup.findMany as jest.Mock).mockResolvedValue([
        { id: 'expired-1' },
        { id: 'expired-2' },
      ])
      ;(mockGroup.deleteMany as jest.Mock).mockResolvedValue({ count: 2 })

      const result = await cleanupExpiredGroups(7) // 7-day grace period

      expect(result.permanentlyDeleted).toBe(2)
      expect(result.groupIds).toEqual(['expired-1', 'expired-2'])
      expect(mockGroup.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['expired-1', 'expired-2'] } },
      })
    })

    it('should not delete groups within grace period', async () => {
      ;(mockGroup.findMany as jest.Mock).mockResolvedValue([])

      const result = await cleanupExpiredGroups(7)

      expect(result).toEqual({ permanentlyDeleted: 0, groupIds: [] })
      expect(mockGroup.deleteMany).not.toHaveBeenCalled()
    })

    it('should query with correct cutoff date', async () => {
      ;(mockGroup.findMany as jest.Mock).mockResolvedValue([])

      await cleanupExpiredGroups(7)

      expect(mockGroup.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: {
            lt: expect.any(Date),
          },
        },
        select: { id: true },
      })

      // Verify the cutoff date is approximately 7 days ago
      const call = (mockGroup.findMany as jest.Mock).mock.calls[0][0]
      const cutoffDate = call.where.deletedAt.lt as Date
      const now = new Date()
      const expectedCutoff = new Date(now)
      expectedCutoff.setDate(expectedCutoff.getDate() - 7)

      // Allow 1 second tolerance for test execution time
      expect(
        Math.abs(cutoffDate.getTime() - expectedCutoff.getTime()),
      ).toBeLessThan(1000)
    })
  })

  describe('Integration scenario', () => {
    it('should handle full auto-delete cycle', async () => {
      const now = new Date()

      // Group 1: Inactive for 100 days, not deleted yet
      const group1CreatedAt = new Date(now)
      group1CreatedAt.setDate(group1CreatedAt.getDate() - 100)

      // Group 2: Active (has recent activity)
      const group2Activity = new Date(now)
      group2Activity.setDate(group2Activity.getDate() - 10)

      // Step 1: getInactiveGroups - single query returns groups with activities
      ;(mockGroup.findMany as jest.Mock).mockResolvedValueOnce([
        { id: 'group-1', createdAt: group1CreatedAt, activities: [] }, // no activity
        {
          id: 'group-2',
          createdAt: group1CreatedAt,
          activities: [{ time: group2Activity }],
        }, // recent activity
      ])

      const inactiveGroups = await getInactiveGroups(90)
      expect(inactiveGroups).toEqual(['group-1'])

      // Step 2: autoDeleteInactiveGroups - reset mocks and set up for this call
      ;(mockGroup.findMany as jest.Mock).mockResolvedValueOnce([
        { id: 'group-1', createdAt: group1CreatedAt, activities: [] },
      ])
      ;(mockGroup.updateMany as jest.Mock).mockResolvedValue({ count: 1 })

      const softDeleteResult = await autoDeleteInactiveGroups(90)
      expect(softDeleteResult.softDeleted).toBe(1)

      // Step 3: cleanupExpiredGroups
      ;(mockGroup.findMany as jest.Mock).mockResolvedValueOnce([
        { id: 'group-3' },
      ])
      ;(mockGroup.deleteMany as jest.Mock).mockResolvedValue({ count: 1 })

      const cleanupResult = await cleanupExpiredGroups(7)
      expect(cleanupResult.permanentlyDeleted).toBe(1)
    })
  })

  describe('N+1 query optimization (Issue #46)', () => {
    it('should fetch groups with activities in a single query', async () => {
      const now = new Date()
      const oldDate = new Date(now)
      oldDate.setDate(oldDate.getDate() - 100)

      // Create 100 groups to verify single query behavior
      const groups = Array.from({ length: 100 }, (_, i) => ({
        id: `group-${i}`,
        createdAt: oldDate,
        activities: [],
      }))

      ;(mockGroup.findMany as jest.Mock).mockResolvedValue(groups)

      await getInactiveGroups(90)

      // Should only call findMany once, not 100+1 times
      expect(mockGroup.findMany).toHaveBeenCalledTimes(1)
    })
  })
})
