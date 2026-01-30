'use client'

import { useEncryption } from '@/components/encryption-provider'
import { GroupForm } from '@/components/group-form'
import { decryptGroup, encryptGroupFormValues } from '@/lib/encrypt-helpers'
import { GroupFormValues } from '@/lib/schemas'
import { trpc } from '@/trpc/client'
import { useEffect, useRef, useState } from 'react'
import { useCurrentGroup } from '../current-group-context'
import { DeleteGroupButton } from './delete-group-button'

export const EditGroup = () => {
  const { groupId } = useCurrentGroup()
  const { data, isLoading: isQueryLoading } = trpc.groups.getDetails.useQuery({
    groupId,
  })
  const { mutateAsync } = trpc.groups.update.useMutation()
  const utils = trpc.useUtils()
  const { encryptionKey, isLoading: isKeyLoading, hasKey } = useEncryption()

  const [decryptedGroup, setDecryptedGroup] = useState<typeof data>(undefined)
  const lastDecryptedRef = useRef<{ id: string; withKey: boolean } | null>(null)

  // Decrypt group data when both data and key are available
  useEffect(() => {
    let isMounted = true // Track if component is still mounted (Issue #53)

    const shouldDecryptWithKey = hasKey && encryptionKey !== null

    // Skip if already processed with same state
    if (
      data?.group?.id &&
      lastDecryptedRef.current?.id === data.group.id &&
      lastDecryptedRef.current?.withKey === shouldDecryptWithKey
    ) {
      return
    }

    async function decrypt() {
      if (!data?.group) {
        if (isMounted) setDecryptedGroup(undefined)
        return
      }

      // If no encryption key, use original data
      if (!isKeyLoading && !hasKey) {
        if (isMounted) {
          setDecryptedGroup(data)
          lastDecryptedRef.current = { id: data.group.id, withKey: false }
        }
        return
      }

      if (!encryptionKey) {
        return // Still loading
      }

      try {
        const decrypted = await decryptGroup(data.group, encryptionKey)
        if (isMounted) {
          setDecryptedGroup({
            ...data,
            group: decrypted,
          })
          lastDecryptedRef.current = { id: data.group.id, withKey: true }
        }
      } catch (error) {
        console.warn('Failed to decrypt group for editing:', error)
        if (isMounted) {
          setDecryptedGroup(data)
          lastDecryptedRef.current = { id: data.group.id, withKey: true }
        }
      }
    }

    decrypt()

    return () => {
      isMounted = false
    }
  }, [data?.group?.id, encryptionKey, isKeyLoading, hasKey, data])

  const isLoading = isQueryLoading || isKeyLoading || !decryptedGroup

  if (isLoading) return <></>

  return (
    <div className="flex flex-col gap-6">
      <GroupForm
        group={decryptedGroup?.group}
        onSubmit={async (groupFormValues, participantId) => {
          // Encrypt group data if encryption key is available
          const dataToSend = encryptionKey
            ? await encryptGroupFormValues(groupFormValues, encryptionKey)
            : groupFormValues

          await mutateAsync({
            groupId,
            participantId,
            groupFormValues: dataToSend as GroupFormValues,
          })
          await utils.groups.invalidate()
        }}
        protectedParticipantIds={decryptedGroup?.participantsWithExpenses}
      />

      <div className="border-t pt-6">
        <DeleteGroupButton />
      </div>
    </div>
  )
}
