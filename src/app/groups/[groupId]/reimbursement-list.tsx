'use client'

import { Button } from '@/components/ui/button'
import { Reimbursement } from '@/lib/balances'
import { Currency } from '@/lib/currency'
import { setReimbursementAmount } from '@/lib/reimbursement-prefill'
import { formatCurrency } from '@/lib/utils'
import { Participant } from '@prisma/client'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

type Props = {
  reimbursements: Reimbursement[]
  participants: Participant[]
  currency: Currency
  groupId: string
}

export function ReimbursementList({
  reimbursements,
  participants,
  currency,
  groupId,
}: Props) {
  const locale = useLocale()
  const t = useTranslations('Balances.Reimbursements')
  const router = useRouter()
  if (reimbursements.length === 0) {
    return <p className="text-sm pb-6">{t('noImbursements')}</p>
  }

  const getParticipant = (id: string) => participants.find((p) => p.id === id)

  // The amount is derived from decrypted balances (plaintext). Keep it out of
  // the URL query so it is never sent to the server; pass it via an in-memory
  // store instead (see reimbursement-prefill.ts).
  const handleMarkAsPaid = (reimbursement: Reimbursement) => {
    setReimbursementAmount(
      groupId,
      reimbursement.from,
      reimbursement.to,
      reimbursement.amount,
    )
    router.push(
      `/groups/${groupId}/expenses/create?reimbursement=yes&from=${reimbursement.from}&to=${reimbursement.to}`,
    )
  }

  return (
    <div className="text-sm">
      {reimbursements.map((reimbursement, index) => (
        <div className="py-4 flex justify-between" key={index}>
          <div className="flex flex-col gap-1 items-start sm:flex-row sm:items-baseline sm:gap-4">
            <div>
              {t.rich('owes', {
                from: getParticipant(reimbursement.from)?.name ?? '',
                to: getParticipant(reimbursement.to)?.name ?? '',
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </div>
            <Button
              variant="link"
              type="button"
              className="-mx-4 -my-3"
              onClick={() => handleMarkAsPaid(reimbursement)}
            >
              {t('markAsPaid')}
            </Button>
          </div>
          <div>{formatCurrency(currency, reimbursement.amount, locale)}</div>
        </div>
      ))}
    </div>
  )
}
