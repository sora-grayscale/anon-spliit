'use client'
import { ExpenseCard } from '@/app/groups/[groupId]/expenses/expense-card'
import { getGroupExpensesAction } from '@/app/groups/[groupId]/expenses/expense-list-fetch-action'
import { useEncryption } from '@/components/encryption-provider'
import { Button } from '@/components/ui/button'
import { SearchBar } from '@/components/ui/search-bar'
import { Skeleton } from '@/components/ui/skeleton'
import { decryptExpenses } from '@/lib/encrypt-helpers'
import { getCurrencyFromGroup } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import dayjs, { type Dayjs } from 'dayjs'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { useInView } from 'react-intersection-observer'
import { useDebounce } from 'use-debounce'
import { useCurrentGroup } from '../current-group-context'

const PAGE_SIZE = 20

type ExpensesType = NonNullable<
  Awaited<ReturnType<typeof getGroupExpensesAction>>
>

const EXPENSE_GROUPS = {
  UPCOMING: 'upcoming',
  THIS_WEEK: 'thisWeek',
  EARLIER_THIS_MONTH: 'earlierThisMonth',
  LAST_MONTH: 'lastMonth',
  EARLIER_THIS_YEAR: 'earlierThisYear',
  LAST_YEAR: 'lastYear',
  OLDER: 'older',
}

function getExpenseGroup(date: Dayjs, today: Dayjs) {
  if (today.isBefore(date)) {
    return EXPENSE_GROUPS.UPCOMING
  } else if (today.isSame(date, 'week')) {
    return EXPENSE_GROUPS.THIS_WEEK
  } else if (today.isSame(date, 'month')) {
    return EXPENSE_GROUPS.EARLIER_THIS_MONTH
  } else if (today.subtract(1, 'month').isSame(date, 'month')) {
    return EXPENSE_GROUPS.LAST_MONTH
  } else if (today.isSame(date, 'year')) {
    return EXPENSE_GROUPS.EARLIER_THIS_YEAR
  } else if (today.subtract(1, 'year').isSame(date, 'year')) {
    return EXPENSE_GROUPS.LAST_YEAR
  } else {
    return EXPENSE_GROUPS.OLDER
  }
}

function getGroupedExpensesByDate(expenses: ExpensesType) {
  const today = dayjs()
  return expenses.reduce((result: { [key: string]: ExpensesType }, expense) => {
    const expenseGroup = getExpenseGroup(dayjs(expense.expenseDate), today)
    result[expenseGroup] = result[expenseGroup] ?? []
    result[expenseGroup].push(expense)
    return result
  }, {})
}

export function ExpenseList() {
  const { groupId, group } = useCurrentGroup()
  const [searchText, setSearchText] = useState('')
  const [debouncedSearchText] = useDebounce(searchText, 300)

  const participants = group?.participants

  useEffect(() => {
    if (!participants) return

    const activeUser = localStorage.getItem('newGroup-activeUser')
    const newUser = localStorage.getItem(`${groupId}-newUser`)
    if (activeUser || newUser) {
      localStorage.removeItem('newGroup-activeUser')
      localStorage.removeItem(`${groupId}-newUser`)
      if (activeUser === 'None') {
        localStorage.setItem(`${groupId}-activeUser`, 'None')
      } else {
        const userId = participants.find(
          (p) => p.name === (activeUser || newUser),
        )?.id
        if (userId) {
          localStorage.setItem(`${groupId}-activeUser`, userId)
        }
      }
    }
  }, [groupId, participants])

  return (
    <>
      <SearchBar onValueChange={(value) => setSearchText(value)} />
      <ExpenseListForSearch
        groupId={groupId}
        searchText={debouncedSearchText}
      />
    </>
  )
}

const ExpenseListForSearch = ({
  groupId,
  searchText,
}: {
  groupId: string
  searchText: string
}) => {
  const utils = trpc.useUtils()
  const { group } = useCurrentGroup()
  const { encryptionKey, isLoading: isKeyLoading, hasKey } = useEncryption()

  useEffect(() => {
    // Until we use tRPC more widely and can invalidate the cache on expense
    // update, it's easier and safer to invalidate the cache on page load.
    utils.groups.expenses.invalidate()
  }, [utils])

  const t = useTranslations('Expenses')
  const { ref: loadingRef, inView } = useInView()

  const {
    data,
    isLoading: expensesAreLoading,
    fetchNextPage,
  } = trpc.groups.expenses.list.useInfiniteQuery(
    { groupId, limit: PAGE_SIZE, filter: searchText },
    { getNextPageParam: ({ nextCursor }) => nextCursor },
  )

  // Memoize rawExpenses to avoid reference changes triggering infinite loops
  const rawExpenses = useMemo(
    () => data?.pages.flatMap((page) => page.expenses),
    [data?.pages],
  )
  const hasMore = data?.pages.at(-1)?.hasMore ?? false

  // Decrypt expenses using useMemo instead of useEffect to avoid infinite loops
  const expenses = useMemo(() => {
    if (!rawExpenses) return undefined

    // If no encryption key and not loading, use raw data
    if (!isKeyLoading && !hasKey) {
      return rawExpenses
    }

    // If still loading key or no key yet, return undefined
    if (!encryptionKey) {
      return undefined
    }

    // Note: We can't use async in useMemo, so we return raw and decrypt in effect
    return rawExpenses
  }, [rawExpenses, encryptionKey, isKeyLoading, hasKey])

  // Handle async decryption
  const [decryptedExpenses, setDecryptedExpenses] =
    useState<typeof rawExpenses>(undefined)
  const lastDecryptedRef = useRef<{ key: string; withKey: boolean } | null>(
    null,
  )

  useEffect(() => {
    let isMounted = true // Track if component is still mounted (Issue #53)

    const expenseIds = rawExpenses?.map((e) => e.id).join(',') || ''
    const shouldDecryptWithKey = hasKey && encryptionKey !== null

    // Skip if already processed with same state
    if (
      lastDecryptedRef.current?.key === expenseIds &&
      lastDecryptedRef.current?.withKey === shouldDecryptWithKey
    ) {
      return
    }

    async function decrypt() {
      if (!rawExpenses) {
        if (isMounted) setDecryptedExpenses(undefined)
        return
      }

      // If no encryption key, use original data
      if (!isKeyLoading && !hasKey) {
        if (isMounted) {
          setDecryptedExpenses(rawExpenses)
          lastDecryptedRef.current = { key: expenseIds, withKey: false }
        }
        return
      }

      if (!encryptionKey) {
        return // Still loading
      }

      try {
        const decrypted = await decryptExpenses(rawExpenses, encryptionKey)
        if (isMounted) {
          setDecryptedExpenses(decrypted)
          lastDecryptedRef.current = { key: expenseIds, withKey: true }
        }
      } catch (error) {
        console.warn('Failed to decrypt expenses:', error)
        if (isMounted) {
          setDecryptedExpenses(rawExpenses)
          lastDecryptedRef.current = { key: expenseIds, withKey: true }
        }
      }
    }

    decrypt()

    return () => {
      isMounted = false
    }
  }, [rawExpenses, encryptionKey, isKeyLoading, hasKey])

  const displayExpenses = decryptedExpenses

  const isLoading =
    expensesAreLoading || isKeyLoading || !displayExpenses || !group

  useEffect(() => {
    if (inView && hasMore && !isLoading) fetchNextPage()
  }, [fetchNextPage, hasMore, inView, isLoading])

  const groupedExpensesByDate = useMemo(
    () => (displayExpenses ? getGroupedExpensesByDate(displayExpenses) : {}),
    [displayExpenses],
  )

  // Memoize currency to ensure stable reference for React.memo in ExpenseCard
  const currency = useMemo(
    () => (group ? getCurrencyFromGroup(group) : null),
    [group],
  )

  if (isLoading) return <ExpensesLoading />

  if (displayExpenses.length === 0)
    return (
      <p className="px-6 text-sm py-6">
        {t('noExpenses')}{' '}
        <Button variant="link" asChild className="-m-4">
          <Link href={`/groups/${groupId}/expenses/create`}>
            {t('createFirst')}
          </Link>
        </Button>
      </p>
    )

  return (
    <>
      {Object.values(EXPENSE_GROUPS).map((expenseGroup: string) => {
        let groupExpenses = groupedExpensesByDate[expenseGroup]
        if (!groupExpenses || groupExpenses.length === 0) return null

        return (
          <div key={expenseGroup}>
            <div
              className={
                'text-muted-foreground text-xs pl-4 sm:pl-6 py-1 font-semibold sticky top-16 bg-white dark:bg-[#1b1917]'
              }
            >
              {t(`Groups.${expenseGroup}`)}
            </div>
            {groupExpenses.map((expense) => (
              <ExpenseCard
                key={expense.id}
                expense={expense}
                currency={currency!}
                groupId={groupId}
                participantCount={group.participants.length}
              />
            ))}
          </div>
        )
      })}
      {hasMore && <ExpensesLoading ref={loadingRef} />}
    </>
  )
}

const ExpensesLoading = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div ref={ref}>
      <Skeleton className="mx-4 sm:mx-6 mt-1 mb-2 h-3 w-32 rounded-full" />
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex justify-between items-start px-2 sm:px-6 py-4 text-sm gap-2"
        >
          <div className="flex-0 pl-2 pr-1">
            <Skeleton className="h-4 w-4 rounded-full" />
          </div>
          <div className="flex-1 flex flex-col gap-2">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="h-4 w-32 rounded-full" />
          </div>
          <div className="flex-0 flex flex-col gap-2 items-end mr-2 sm:mr-12">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="h-4 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
})
ExpensesLoading.displayName = 'ExpensesLoading'
