import { safeGetJSON, safeSetJSON } from '@/lib/storage'
import { z } from 'zod'

export const recentGroupsSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string(),
  }),
)

export const starredGroupsSchema = z.array(z.string())
export const archivedGroupsSchema = z.array(z.string())

export type RecentGroups = z.infer<typeof recentGroupsSchema>
export type RecentGroup = RecentGroups[number]

const STORAGE_KEY = 'recentGroups'
const STARRED_GROUPS_STORAGE_KEY = 'starredGroups'
const ARCHIVED_GROUPS_STORAGE_KEY = 'archivedGroups'

// Default limits to prevent performance issues with large datasets (Issue #55)
const DEFAULT_RECENT_GROUPS_LIMIT = 100
const DEFAULT_STARRED_GROUPS_LIMIT = 50
const DEFAULT_ARCHIVED_GROUPS_LIMIT = 50

/**
 * Get recent groups from localStorage with optional limit
 * @param limit Maximum number of groups to return (default: 100)
 */
export function getRecentGroups(limit: number = DEFAULT_RECENT_GROUPS_LIMIT) {
  const groupsInStorageRaw = safeGetJSON(STORAGE_KEY, [])
  const parseResult = recentGroupsSchema.safeParse(groupsInStorageRaw)
  const groups = parseResult.success ? parseResult.data : []
  // Return limited results (groups are already ordered by most recent first)
  return groups.slice(0, limit)
}

export function saveRecentGroup(group: RecentGroup) {
  // Use Infinity to get all groups when modifying storage
  const recentGroups = getRecentGroups(Infinity)
  safeSetJSON(STORAGE_KEY, [
    group,
    ...recentGroups.filter((rg) => rg.id !== group.id),
  ])
}

export function deleteRecentGroup(group: RecentGroup) {
  // Use Infinity to get all groups when modifying storage
  const recentGroups = getRecentGroups(Infinity)
  safeSetJSON(
    STORAGE_KEY,
    recentGroups.filter((rg) => rg.id !== group.id),
  )
}

/**
 * Get starred groups from localStorage with optional limit
 * @param limit Maximum number of groups to return (default: 50)
 */
export function getStarredGroups(limit: number = DEFAULT_STARRED_GROUPS_LIMIT) {
  const starredGroupsRaw = safeGetJSON(STARRED_GROUPS_STORAGE_KEY, [])
  const parseResult = starredGroupsSchema.safeParse(starredGroupsRaw)
  const groups = parseResult.success ? parseResult.data : []
  return groups.slice(0, limit)
}

export function starGroup(groupId: string) {
  // Use Infinity to get all groups when modifying storage
  const starredGroups = getStarredGroups(Infinity)
  safeSetJSON(STARRED_GROUPS_STORAGE_KEY, [...starredGroups, groupId])
}

export function unstarGroup(groupId: string) {
  // Use Infinity to get all groups when modifying storage
  const starredGroups = getStarredGroups(Infinity)
  safeSetJSON(
    STARRED_GROUPS_STORAGE_KEY,
    starredGroups.filter((g) => g !== groupId),
  )
}

/**
 * Get archived groups from localStorage with optional limit
 * @param limit Maximum number of groups to return (default: 50)
 */
export function getArchivedGroups(
  limit: number = DEFAULT_ARCHIVED_GROUPS_LIMIT,
) {
  const archivedGroupsRaw = safeGetJSON(ARCHIVED_GROUPS_STORAGE_KEY, [])
  const parseResult = archivedGroupsSchema.safeParse(archivedGroupsRaw)
  const groups = parseResult.success ? parseResult.data : []
  return groups.slice(0, limit)
}

export function archiveGroup(groupId: string) {
  // Use Infinity to get all groups when modifying storage
  const archivedGroups = getArchivedGroups(Infinity)
  safeSetJSON(ARCHIVED_GROUPS_STORAGE_KEY, [...archivedGroups, groupId])
}

export function unarchiveGroup(groupId: string) {
  // Use Infinity to get all groups when modifying storage
  const archivedGroups = getArchivedGroups(Infinity)
  safeSetJSON(
    ARCHIVED_GROUPS_STORAGE_KEY,
    archivedGroups.filter((g) => g !== groupId),
  )
}
