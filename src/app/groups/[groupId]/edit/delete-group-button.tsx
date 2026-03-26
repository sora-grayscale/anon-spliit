'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ENCRYPTION_KEY_PREFIX,
  removeSessionKey,
  safeRemoveItem,
  SESSION_PWD_KEY_PREFIX,
} from '@/lib/storage'
import { trpc } from '@/trpc/client'
import { Loader2, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useCurrentGroup } from '../current-group-context'

const GRACE_PERIOD_DAYS = 7

export function DeleteGroupButton() {
  const t = useTranslations('GroupForm.Delete')
  const { groupId, group } = useCurrentGroup()
  const router = useRouter()
  const utils = trpc.useUtils()
  const [isDeleting, setIsDeleting] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [confirmName, setConfirmName] = useState('')

  const { mutateAsync: deleteGroup } = trpc.groups.delete.useMutation()

  const groupName = group?.name || ''
  const isConfirmValid = confirmName === groupName

  const handleDelete = async () => {
    if (!isConfirmValid) return

    setIsDeleting(true)
    try {
      await deleteGroup({ groupId })
      // Clean up encryption keys from storage (Issue #108)
      safeRemoveItem(`${ENCRYPTION_KEY_PREFIX}${groupId}`)
      removeSessionKey(`${SESSION_PWD_KEY_PREFIX}${groupId}`)
      // Invalidate cache so the groups list shows updated deletedAt
      await utils.groups.invalidate()
      router.push('/groups')
    } catch (error) {
      console.error('Failed to delete group:', error)
      setIsDeleting(false)
    }
  }

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open) {
      setConfirmName('')
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="destructive" className="w-full">
          <Trash2 className="w-4 h-4 mr-2" />
          {t('button')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div className="p-3 bg-muted rounded-md text-sm">
            <p className="text-muted-foreground">
              {t('gracePeriodNotice', { days: GRACE_PERIOD_DAYS })}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-name">
              {t('confirmLabel', { name: groupName })}
            </Label>
            <Input
              id="confirm-name"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={groupName}
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isDeleting}>
              {t('cancel')}
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting || !isConfirmValid}
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('deleting')}
              </>
            ) : (
              t('confirm')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
