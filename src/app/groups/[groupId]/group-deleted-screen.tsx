'use client'

import { deleteRecentGroup } from '@/app/groups/recent-groups-helpers'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import {
  ENCRYPTION_KEY_PREFIX,
  removeSessionKey,
  safeRemoveItem,
  SESSION_PWD_KEY_PREFIX,
} from '@/lib/storage'
import { trpc } from '@/trpc/client'
import { Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

const GRACE_PERIOD_DAYS = 7

interface GroupDeletedScreenProps {
  groupId: string
  groupName: string
  deletedAt: Date
}

export function GroupDeletedScreen({
  groupId,
  groupName,
  deletedAt,
}: GroupDeletedScreenProps) {
  const t = useTranslations('GroupDeleted')
  const router = useRouter()
  const utils = trpc.useUtils()

  const [isRestoring, setIsRestoring] = useState(false)
  const [isPermanentlyDeleting, setIsPermanentlyDeleting] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const { mutateAsync: restoreGroup } = trpc.groups.restore.useMutation()
  const { mutateAsync: permanentDelete } =
    trpc.groups.permanentDelete.useMutation()

  // Calculate days remaining
  const deletedDate = new Date(deletedAt)
  const expirationDate = new Date(deletedDate)
  expirationDate.setDate(expirationDate.getDate() + GRACE_PERIOD_DAYS)

  const now = new Date()
  const daysRemaining = Math.max(
    0,
    Math.ceil(
      (expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    ),
  )

  const handleRestore = async () => {
    setIsRestoring(true)
    try {
      await restoreGroup({ groupId })
      await utils.groups.invalidate()
      // Force a full page reload to show restored group
      window.location.reload()
    } catch (error) {
      console.error('Failed to restore group:', error)
      setIsRestoring(false)
    }
  }

  const handlePermanentDelete = async () => {
    setIsPermanentlyDeleting(true)
    try {
      await permanentDelete({ groupId })
      deleteRecentGroup({ id: groupId, name: groupName })
      // Clean up encryption keys from storage (Issue #108)
      safeRemoveItem(`${ENCRYPTION_KEY_PREFIX}${groupId}`)
      removeSessionKey(`${SESSION_PWD_KEY_PREFIX}${groupId}`)
      router.push('/groups')
    } catch (error) {
      console.error('Failed to permanently delete group:', error)
      setIsPermanentlyDeleting(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <Trash2 className="w-6 h-6 text-destructive" />
          </div>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>
            {t('description', { name: groupName })}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className="p-4 bg-muted rounded-md text-center">
            <p className="text-2xl font-bold text-destructive">
              {daysRemaining}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('daysRemaining', { count: daysRemaining })}
            </p>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-2">
          <Button
            className="w-full"
            onClick={handleRestore}
            disabled={isRestoring || isPermanentlyDeleting}
          >
            {isRestoring ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('restoring')}
              </>
            ) : (
              <>
                <RotateCcw className="w-4 h-4 mr-2" />
                {t('restore')}
              </>
            )}
          </Button>

          <Dialog
            open={isDeleteDialogOpen}
            onOpenChange={setIsDeleteDialogOpen}
          >
            <DialogTrigger asChild>
              <Button
                variant="outline"
                className="w-full text-destructive hover:text-destructive"
                disabled={isRestoring || isPermanentlyDeleting}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {t('deleteNow')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('permanentDeleteTitle')}</DialogTitle>
                <DialogDescription>
                  {t('permanentDeleteDescription')}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" disabled={isPermanentlyDeleting}>
                    {t('cancel')}
                  </Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  onClick={handlePermanentDelete}
                  disabled={isPermanentlyDeleting}
                >
                  {isPermanentlyDeleting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {t('deleting')}
                    </>
                  ) : (
                    t('confirmDelete')
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardFooter>
      </Card>
    </div>
  )
}
