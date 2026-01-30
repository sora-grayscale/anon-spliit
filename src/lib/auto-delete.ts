/**
 * Auto-delete functionality for inactive groups (Issue #10)
 *
 * This module provides functions to automatically delete inactive groups
 * after a configurable period of inactivity.
 */

import { prisma } from '@/lib/prisma'

/**
 * Get groups that have been inactive for more than the specified number of days
 * Uses the Activity table to determine the last activity date
 * @param inactiveDays Number of days of inactivity
 * @returns Array of inactive group IDs
 */
export async function getInactiveGroups(
  inactiveDays: number,
): Promise<string[]> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - inactiveDays)

  // Get all groups with their latest activity in a single query
  // This avoids the N+1 query problem by using Prisma's include with take: 1
  const activeGroups = await prisma.group.findMany({
    where: {
      deletedAt: null,
    },
    select: {
      id: true,
      createdAt: true,
      activities: {
        orderBy: {
          time: 'desc',
        },
        take: 1,
        select: {
          time: true,
        },
      },
    },
  })

  // Filter groups by their last activity time
  const inactiveGroupIds: string[] = []

  for (const group of activeGroups) {
    // Use the latest activity time, or group creation time if no activity exists
    const lastActivityTime = group.activities[0]?.time ?? group.createdAt

    if (lastActivityTime < cutoffDate) {
      inactiveGroupIds.push(group.id)
    }
  }

  return inactiveGroupIds
}

/**
 * Soft-delete groups that have been inactive for the specified number of days
 * @param inactiveDays Number of days of inactivity before soft-deletion
 * @returns Number of groups soft-deleted
 */
export async function autoDeleteInactiveGroups(
  inactiveDays: number,
): Promise<{ softDeleted: number; groupIds: string[] }> {
  if (inactiveDays <= 0) {
    return { softDeleted: 0, groupIds: [] }
  }

  const inactiveGroupIds = await getInactiveGroups(inactiveDays)

  if (inactiveGroupIds.length === 0) {
    return { softDeleted: 0, groupIds: [] }
  }

  // Soft-delete all inactive groups
  await prisma.group.updateMany({
    where: {
      id: { in: inactiveGroupIds },
    },
    data: {
      deletedAt: new Date(),
    },
  })

  return { softDeleted: inactiveGroupIds.length, groupIds: inactiveGroupIds }
}

/**
 * Permanently delete groups that have been soft-deleted for longer than the grace period
 * @param gracePeriodDays Number of days after soft-deletion before permanent deletion
 * @returns Number of groups permanently deleted
 */
export async function cleanupExpiredGroups(
  gracePeriodDays: number,
): Promise<{ permanentlyDeleted: number; groupIds: string[] }> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - gracePeriodDays)

  // Find groups that were soft-deleted before the cutoff date
  const expiredGroups = await prisma.group.findMany({
    where: {
      deletedAt: {
        lt: cutoffDate,
      },
    },
    select: {
      id: true,
    },
  })

  if (expiredGroups.length === 0) {
    return { permanentlyDeleted: 0, groupIds: [] }
  }

  const expiredGroupIds = expiredGroups.map((g) => g.id)

  // Permanently delete all expired groups (cascade will handle related records)
  await prisma.group.deleteMany({
    where: {
      id: { in: expiredGroupIds },
    },
  })

  return {
    permanentlyDeleted: expiredGroupIds.length,
    groupIds: expiredGroupIds,
  }
}
