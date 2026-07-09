'use client'
import {
  Activity,
  ActivityItem,
} from '@/app/groups/[groupId]/activity/activity-item'
import { useEncryption } from '@/components/encryption-provider'
import { EncryptionRequired } from '@/components/encryption-required'
import { Skeleton } from '@/components/ui/skeleton'
import { decryptActivities } from '@/lib/encrypt-helpers'
import { trpc } from '@/trpc/client'
import dayjs, { type Dayjs } from 'dayjs'
import { useTranslations } from 'next-intl'
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { useInView } from 'react-intersection-observer'
import { useCurrentGroup } from '../current-group-context'

const PAGE_SIZE = 20

const DATE_GROUPS = {
  TODAY: 'today',
  YESTERDAY: 'yesterday',
  EARLIER_THIS_WEEK: 'earlierThisWeek',
  LAST_WEEK: 'lastWeek',
  EARLIER_THIS_MONTH: 'earlierThisMonth',
  LAST_MONTH: 'lastMonth',
  EARLIER_THIS_YEAR: 'earlierThisYear',
  LAST_YEAR: 'lastYear',
  OLDER: 'older',
}

function getDateGroup(date: Dayjs, today: Dayjs) {
  if (today.isSame(date, 'day')) {
    return DATE_GROUPS.TODAY
  } else if (today.subtract(1, 'day').isSame(date, 'day')) {
    return DATE_GROUPS.YESTERDAY
  } else if (today.isSame(date, 'week')) {
    return DATE_GROUPS.EARLIER_THIS_WEEK
  } else if (today.subtract(1, 'week').isSame(date, 'week')) {
    return DATE_GROUPS.LAST_WEEK
  } else if (today.isSame(date, 'month')) {
    return DATE_GROUPS.EARLIER_THIS_MONTH
  } else if (today.subtract(1, 'month').isSame(date, 'month')) {
    return DATE_GROUPS.LAST_MONTH
  } else if (today.isSame(date, 'year')) {
    return DATE_GROUPS.EARLIER_THIS_YEAR
  } else if (today.subtract(1, 'year').isSame(date, 'year')) {
    return DATE_GROUPS.LAST_YEAR
  } else {
    return DATE_GROUPS.OLDER
  }
}

function getGroupedActivitiesByDate(activities: Activity[]) {
  const today = dayjs()
  return activities.reduce(
    (result, activity) => {
      const activityGroup = getDateGroup(dayjs(activity.time), today)
      result[activityGroup] = result[activityGroup] ?? []
      result[activityGroup].push(activity)
      return result
    },
    {} as {
      [key: string]: Activity[]
    },
  )
}

const ActivitiesLoading = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div ref={ref} className="flex flex-col gap-4">
      <Skeleton className="mt-2 h-3 w-24" />
      {Array(5)
        .fill(undefined)
        .map((_, index) => (
          <div key={index} className="flex gap-2 p-2">
            <div className="flex-0">
              <Skeleton className="h-3 w-12" />
            </div>
            <div className="flex-1">
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
        ))}
    </div>
  )
})
ActivitiesLoading.displayName = 'ActivitiesLoading'

export function ActivityList() {
  const t = useTranslations('Activity')
  const { group, groupId } = useCurrentGroup()
  const { encryptionKey, isLoading: isKeyLoading, hasKey } = useEncryption()

  const {
    data: activitiesData,
    isLoading: isQueryLoading,
    fetchNextPage,
  } = trpc.groups.activities.list.useInfiniteQuery(
    { groupId, limit: PAGE_SIZE },
    { getNextPageParam: ({ nextCursor }) => nextCursor },
  )
  const { ref: loadingRef, inView } = useInView()

  // Memoize raw activities
  const rawActivities = useMemo(
    () => activitiesData?.pages.flatMap((page) => page.activities),
    [activitiesData?.pages],
  )
  const hasMore = activitiesData?.pages.at(-1)?.hasMore ?? false

  // Decrypt activities
  const [decryptedActivities, setDecryptedActivities] =
    useState<typeof rawActivities>(undefined)
  const [decryptionError, setDecryptionError] = useState(false)
  const lastDecryptedRef = useRef<{
    activityKey: string
    encryptionKey: Uint8Array | null
  } | null>(null)

  useEffect(() => {
    let isMounted = true // Track if component is still mounted (Issue #53)

    const stableKey =
      rawActivities
        ?.map((a) =>
          JSON.stringify([
            a.id,
            a.data,
            a.time,
            a.activityType,
            a.participantId,
            a.expenseId,
            Boolean(a.expense),
          ]),
        )
        .join('|') || ''

    // Skip if already processed with same state
    if (
      rawActivities &&
      lastDecryptedRef.current?.activityKey === stableKey &&
      lastDecryptedRef.current?.encryptionKey === encryptionKey
    ) {
      return
    }

    async function decrypt() {
      if (!rawActivities) {
        if (isMounted) {
          setDecryptedActivities(undefined)
          setDecryptionError(false)
        }
        return
      }

      // If no encryption key, use original data
      if (!isKeyLoading && !hasKey) {
        if (isMounted) {
          setDecryptedActivities(rawActivities)
          setDecryptionError(false)
          lastDecryptedRef.current = {
            activityKey: stableKey,
            encryptionKey: null,
          }
        }
        return
      }

      if (!encryptionKey) {
        return // Still loading
      }

      try {
        const decrypted = await decryptActivities(rawActivities, encryptionKey)
        if (isMounted) {
          setDecryptedActivities(decrypted)
          setDecryptionError(false)
          lastDecryptedRef.current = {
            activityKey: stableKey,
            encryptionKey,
          }
        }
      } catch (error) {
        console.warn('Failed to decrypt activities:', error)
        if (isMounted) {
          setDecryptedActivities([])
          setDecryptionError(true)
          lastDecryptedRef.current = {
            activityKey: stableKey,
            encryptionKey,
          }
        }
      }
    }

    decrypt()

    return () => {
      isMounted = false
    }
  }, [rawActivities, encryptionKey, isKeyLoading, hasKey])

  const activities = decryptedActivities
  const isLoading = isQueryLoading || isKeyLoading || !activities || !group

  useEffect(() => {
    if (inView && hasMore && !isLoading) fetchNextPage()
  }, [fetchNextPage, hasMore, inView, isLoading])

  if (isLoading) return <ActivitiesLoading />

  if (decryptionError) return <EncryptionRequired groupId={groupId} />

  const groupedActivitiesByDate = getGroupedActivitiesByDate(activities)

  return activities.length > 0 ? (
    <>
      {Object.values(DATE_GROUPS).map((dateGroup: string) => {
        let groupActivities = groupedActivitiesByDate[dateGroup]
        if (!groupActivities || groupActivities.length === 0) return null
        const dateStyle =
          dateGroup == DATE_GROUPS.TODAY || dateGroup == DATE_GROUPS.YESTERDAY
            ? undefined
            : 'medium'

        return (
          <div key={dateGroup}>
            <div
              className={
                'text-muted-foreground text-xs py-1 font-semibold sticky top-16 bg-white dark:bg-[#1b1917]'
              }
            >
              {t(`Groups.${dateGroup}`)}
            </div>
            {groupActivities.map((activity) => {
              const participant =
                activity.participantId !== null
                  ? group.participants.find(
                      (p) => p.id === activity.participantId,
                    )
                  : undefined
              return (
                <ActivityItem
                  key={activity.id}
                  groupId={groupId}
                  activity={activity}
                  participant={participant}
                  dateStyle={dateStyle}
                />
              )
            })}
          </div>
        )
      })}
      {hasMore && <ActivitiesLoading ref={loadingRef} />}
    </>
  ) : (
    <p className="text-sm py-6">{t('noActivity')}</p>
  )
}
