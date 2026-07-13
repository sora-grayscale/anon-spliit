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
        if (navigator.share) {
          navigator.share({ text, url })
        } else {
          // Do not log `url`/`text`: the share URL contains the encryption key
          // in its fragment, and logging it would expose key material to the
          // console (DevTools, extensions, screen shares).
          console.warn('Web Share API is not available')
        }
      }}
    >
      <Share className="w-4 h-4" />
    </Button>
  )
}

function useCanShare(url: string, text: string) {
  const [canShare, setCanShare] = useState<boolean | null>(null)

  useEffect(() => {
    setCanShare(
      navigator.share !== undefined && navigator.canShare({ url, text }),
    )
  }, [text, url])

  return canShare
}
