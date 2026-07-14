'use client'

import { Button } from '@/components/ui/button'
import { Share } from 'lucide-react'
import { useEffect, useState } from 'react'

interface Props {
  text: string
  url: string
}

export function ShareUrlButton({ url, text }: Props) {
  const canShare = useCanShare(url, text)
  if (!canShare) return null

  return (
    <Button
      size="icon"
      variant="secondary"
      type="button"
      onClick={() => {
        if (typeof navigator.share !== 'function') return
        // Rejection (e.g. the user cancelling the share sheet) is expected;
        // never log it — the payload contains the share URL whose fragment
        // carries the encryption key.
        navigator.share({ text, url }).catch(() => {})
      }}
    >
      <Share className="w-4 h-4" />
    </Button>
  )
}

function useCanShare(url: string, text: string) {
  const [canShare, setCanShare] = useState<boolean | null>(null)

  useEffect(() => {
    // `navigator.share` shipped years before `navigator.canShare`; keep the
    // button usable when the runtime has the former but not the latter
    // instead of calling `canShare` and throwing.
    setCanShare(
      typeof navigator.share === 'function' &&
        (typeof navigator.canShare !== 'function' ||
          navigator.canShare({ url, text })),
    )
  }, [text, url])

  return canShare
}
