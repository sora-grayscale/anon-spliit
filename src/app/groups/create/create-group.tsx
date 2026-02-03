'use client'

import { GroupForm } from '@/components/group-form'
import {
  combineKeys,
  deriveKeyFromPassword,
  encrypt,
  generateMasterKey,
  generateSalt,
  keyToBase64,
} from '@/lib/crypto'
import { encryptGroupFormValues } from '@/lib/encrypt-helpers'
import { GroupFormValues } from '@/lib/schemas'
import {
  ENCRYPTION_KEY_PREFIX,
  SESSION_PWD_KEY_PREFIX,
} from '@/lib/storage'
import { trpc } from '@/trpc/client'
import { useRouter } from 'next/navigation'

export const CreateGroup = () => {
  const { mutateAsync } = trpc.groups.create.useMutation()
  const utils = trpc.useUtils()
  const router = useRouter()

  return (
    <GroupForm
      onSubmit={async (groupFormValues) => {
        // Generate encryption key for the new group
        const urlKey = generateMasterKey()
        let encryptionKey = urlKey
        let passwordSalt: string | undefined
        let encryptedPasswordHint: string | undefined
        let passwordKeyBase64: string | undefined

        // If password is set, combine URL key with password-derived key
        if (groupFormValues.password) {
          const salt = generateSalt()
          passwordSalt = keyToBase64(salt)

          // Derive key from password
          const passwordKey = await deriveKeyFromPassword(
            groupFormValues.password,
            salt,
          )
          passwordKeyBase64 = keyToBase64(passwordKey)

          // Combine keys using XOR for double encryption
          encryptionKey = combineKeys(urlKey, passwordKey)

          // Encrypt password hint if provided
          if (groupFormValues.passwordHint) {
            encryptedPasswordHint = await encrypt(
              groupFormValues.passwordHint,
              urlKey, // Use URL key to encrypt hint (so it can be shown before password entry)
            )
          }
        }

        const keyBase64 = keyToBase64(urlKey)
        const combinedKeyBase64 = keyToBase64(encryptionKey)

        // Prepare values for encryption (remove password field, add salt)
        const { password, passwordHint, ...valuesWithoutPassword } =
          groupFormValues
        const valuesForEncryption = {
          ...valuesWithoutPassword,
          passwordSalt,
          passwordHint: encryptedPasswordHint,
        }

        // Encrypt group data before sending to server
        const encryptedValues = await encryptGroupFormValues(
          valuesForEncryption,
          encryptionKey,
        )

        // Add password protection fields (not included by encryptGroupFormValues)
        const groupFormValuesWithPassword = {
          ...encryptedValues,
          passwordSalt,
          passwordHint: encryptedPasswordHint,
        }

        // Send encrypted data to server
        const { groupId } = await mutateAsync({
          groupFormValues: groupFormValuesWithPassword as GroupFormValues,
        })
        await utils.groups.invalidate()

        // Save keys to storage BEFORE redirect so EncryptionProvider can find them
        // This is done after group creation succeeds to avoid storing keys for failed creations
        try {
          // Save the combined key to localStorage (persistent)
          localStorage.setItem(
            `${ENCRYPTION_KEY_PREFIX}${groupId}`,
            combinedKeyBase64,
          )

          // If password was used, also save password-derived key to sessionStorage
          // This allows EncryptionProvider to verify the key combination
          if (passwordKeyBase64) {
            sessionStorage.setItem(
              `${SESSION_PWD_KEY_PREFIX}${groupId}`,
              passwordKeyBase64,
            )
          }
        } catch (error) {
          // Storage might be unavailable (private browsing, etc.)
          // Continue anyway - user will need to re-enter password if needed
          console.warn('Failed to save encryption keys to storage:', error)
        }

        // Redirect with URL key in fragment
        router.push(`/groups/${groupId}#${keyBase64}`)
      }}
    />
  )
}
