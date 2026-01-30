'use client'
import { TotalsGroupSpending } from '@/app/groups/[groupId]/stats/totals-group-spending'
import { TotalsYourShare } from '@/app/groups/[groupId]/stats/totals-your-share'
import { TotalsYourSpendings } from '@/app/groups/[groupId]/stats/totals-your-spending'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { useActiveUser, useBalances } from '@/lib/hooks'
import {
  getTotalActiveUserPaidFor,
  getTotalActiveUserShare,
  getTotalGroupSpending,
} from '@/lib/totals'
import { getCurrencyFromGroup } from '@/lib/utils'
import { AlertCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo } from 'react'
import { useCurrentGroup } from '../current-group-context'

export function Totals() {
  const { groupId, group } = useCurrentGroup()
  const activeUser = useActiveUser(groupId)
  const { expenses, isLoading, decryptionError } = useBalances(groupId)
  const t = useTranslations('Balances')

  const participantId =
    activeUser && activeUser !== 'None' ? activeUser : undefined

  // Calculate stats from decrypted expenses on client side
  const stats = useMemo(() => {
    if (!expenses || expenses.length === 0) {
      return {
        totalGroupSpendings: 0,
        totalParticipantSpendings: undefined as number | undefined,
        totalParticipantShare: undefined as number | undefined,
      }
    }

    return {
      totalGroupSpendings: getTotalGroupSpending(expenses),
      totalParticipantSpendings: participantId
        ? getTotalActiveUserPaidFor(participantId, expenses)
        : undefined,
      totalParticipantShare: participantId
        ? getTotalActiveUserShare(participantId, expenses)
        : undefined,
    }
  }, [expenses, participantId])

  // Issue #80: Show error if decryption failed
  if (decryptionError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{t('decryptionError.title')}</AlertTitle>
        <AlertDescription>{t('decryptionError.description')}</AlertDescription>
      </Alert>
    )
  }

  if (isLoading || !group)
    return (
      <div className="flex flex-col gap-7">
        {[0, 1, 2].map((index) => (
          <div key={index}>
            <Skeleton className="mt-1 h-3 w-48" />
            <Skeleton className="mt-3 h-4 w-20" />
          </div>
        ))}
      </div>
    )

  const {
    totalGroupSpendings,
    totalParticipantShare,
    totalParticipantSpendings,
  } = stats

  const currency = getCurrencyFromGroup(group)

  return (
    <>
      <TotalsGroupSpending
        totalGroupSpendings={totalGroupSpendings}
        currency={currency}
      />
      {participantId && (
        <>
          <TotalsYourSpendings
            totalParticipantSpendings={totalParticipantSpendings}
            currency={currency}
          />
          <TotalsYourShare
            totalParticipantShare={totalParticipantShare}
            currency={currency}
          />
        </>
      )}
    </>
  )
}
