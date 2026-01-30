'use client'

import {
  EncryptionProvider,
  useEncryption,
} from '@/components/encryption-provider'
import { EncryptionRequired } from '@/components/encryption-required'
import { useToast } from '@/components/ui/use-toast'
import { decryptGroup, looksEncrypted } from '@/lib/encrypt-helpers'
import { trpc } from '@/trpc/client'
import { AppRouterOutput } from '@/trpc/routers/_app'
import { useTranslations } from 'next-intl'
import { PropsWithChildren, useEffect, useMemo, useRef, useState } from 'react'
import { CurrentGroupProvider } from './current-group-context'
import { GroupDeletedScreen } from './group-deleted-screen'
import { GroupHeader } from './group-header'
import { SaveGroupLocally } from './save-recent-group'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>
type GroupQueryData = AppRouterOutput['groups']['get']

interface GroupLayoutInnerProps {
  groupId: string
  groupData: GroupQueryData | undefined
  children: React.ReactNode
}

function GroupLayoutInner({
  groupId,
  groupData,
  children,
}: GroupLayoutInnerProps) {
  // Use data passed from parent to avoid duplicate tRPC query (Issue #45)
  const data = groupData
  const t = useTranslations('Groups.NotFound')
  const { toast } = useToast()
  const { encryptionKey, isLoading: isKeyLoading, hasKey } = useEncryption()

  const [decryptedGroup, setDecryptedGroup] = useState<Group | null>(null)
  const [isDecrypting, setIsDecrypting] = useState(false)
  const [needsEncryptionKey, setNeedsEncryptionKey] = useState(false)
  // Track both group ID and whether we used encryption key
  const lastDecryptedRef = useRef<{ id: string; withKey: boolean } | null>(null)

  // Memoize group to avoid reference changes
  const group = data?.group

  useEffect(() => {
    if (data && !data.group) {
      toast({
        description: t('text'),
        variant: 'destructive',
      })
    }
  }, [data, t, toast])

  // Decrypt group data when both data and encryption key are available
  useEffect(() => {
    async function decrypt() {
      if (!group) {
        setDecryptedGroup(null)
        lastDecryptedRef.current = null
        setNeedsEncryptionKey(false)
        return
      }

      // Check if we need to re-decrypt (different group or encryption state changed)
      const shouldDecryptWithKey = hasKey && encryptionKey !== null
      const alreadyDecrypted = lastDecryptedRef.current?.id === group.id
      const keyStateMatches =
        lastDecryptedRef.current?.withKey === shouldDecryptWithKey

      if (alreadyDecrypted && keyStateMatches) {
        return // Already decrypted with same key state
      }

      // Check if the group data looks encrypted
      const groupLooksEncrypted = looksEncrypted(group.name)

      // If no encryption key and finished loading
      if (!isKeyLoading && !hasKey) {
        if (groupLooksEncrypted) {
          // Group is encrypted but we don't have the key
          setNeedsEncryptionKey(true)
          setDecryptedGroup(null)
          return
        }
        // Legacy/unencrypted group
        setDecryptedGroup(group)
        lastDecryptedRef.current = { id: group.id, withKey: false }
        setNeedsEncryptionKey(false)
        return
      }

      if (!encryptionKey) {
        return // Still loading key
      }

      setIsDecrypting(true)
      setNeedsEncryptionKey(false)
      try {
        const decrypted = await decryptGroup(group, encryptionKey)
        setDecryptedGroup(decrypted)
        lastDecryptedRef.current = { id: group.id, withKey: true }
      } catch (error) {
        console.warn('Failed to decrypt group, using original data:', error)
        setDecryptedGroup(group)
        lastDecryptedRef.current = { id: group.id, withKey: true }
      } finally {
        setIsDecrypting(false)
      }
    }

    decrypt()
  }, [group?.id, encryptionKey, isKeyLoading, hasKey, group])

  // Note: Query loading is handled by parent (GroupLayoutClient), so we only check key and decryption
  const isLoading = isKeyLoading || isDecrypting

  // Memoize props before any conditional returns (React hooks rule)
  const props = useMemo(
    () =>
      isLoading || !decryptedGroup
        ? { isLoading: true as const, groupId, group: undefined }
        : { isLoading: false as const, groupId, group: decryptedGroup },
    [isLoading, decryptedGroup, groupId],
  )

  // Show encryption required screen
  if (needsEncryptionKey) {
    return <EncryptionRequired groupId={groupId} />
  }

  // Show deleted group screen
  if (decryptedGroup?.deletedAt) {
    return (
      <GroupDeletedScreen
        groupId={groupId}
        groupName={decryptedGroup.name}
        deletedAt={decryptedGroup.deletedAt}
      />
    )
  }

  if (isLoading) {
    return (
      <CurrentGroupProvider {...props}>
        <GroupHeader />
        {children}
      </CurrentGroupProvider>
    )
  }

  return (
    <CurrentGroupProvider {...props}>
      <GroupHeader />
      {children}
      <SaveGroupLocally />
    </CurrentGroupProvider>
  )
}

export function GroupLayoutClient({
  groupId,
  children,
}: PropsWithChildren<{ groupId: string }>) {
  // Fetch group data to check for password protection
  const { data: groupData, isLoading: isGroupLoading } =
    trpc.groups.get.useQuery({
      groupId,
    })

  // Wait for group data to check for password protection
  if (isGroupLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    )
  }

  return (
    <EncryptionProvider
      passwordSalt={groupData?.group?.passwordSalt}
      passwordHint={groupData?.group?.passwordHint}
      encryptedGroupName={groupData?.group?.name}
    >
      <GroupLayoutInner groupId={groupId} groupData={groupData}>
        {children}
      </GroupLayoutInner>
    </EncryptionProvider>
  )
}
