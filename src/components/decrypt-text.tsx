'use client'

import { useEffect, useState } from 'react'

interface DecryptTextProps {
  text: string
  className?: string
  delay?: number // delay before starting animation (ms)
  duration?: number // total animation duration (ms)
  as?: 'span' | 'h1' | 'h2' | 'p' | 'div'
}

export function DecryptText({
  text,
  className = '',
  delay = 0,
  duration = 1000,
  as: Component = 'span',
}: DecryptTextProps) {
  const [blur, setBlur] = useState(20)
  const [opacity, setOpacity] = useState(0)

  useEffect(() => {
    // Track animation frame ID and cancellation state (Issue #52)
    let animationFrameId: number | null = null
    let cancelled = false

    // Start animation after delay
    const startTimeout = setTimeout(() => {
      // Fade in
      setOpacity(1)

      const startTime = Date.now()

      const animate = () => {
        // Stop if component was unmounted
        if (cancelled) return

        const elapsed = Date.now() - startTime
        const progress = Math.min(elapsed / duration, 1)

        // Ease out cubic for smooth deceleration
        const eased = 1 - Math.pow(1 - progress, 3)

        // Blur goes from 20 to 0
        const newBlur = 20 * (1 - eased)
        setBlur(newBlur)

        if (progress < 1) {
          animationFrameId = requestAnimationFrame(animate)
        } else {
          setBlur(0)
        }
      }

      animationFrameId = requestAnimationFrame(animate)
    }, delay)

    // Cleanup: cancel timeout and animation frame (Issue #52)
    return () => {
      cancelled = true
      clearTimeout(startTimeout)
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }
    }
  }, [delay, duration])

  return (
    <Component
      className={className}
      style={{
        filter: `blur(${blur}px)`,
        opacity,
        transition: 'opacity 0.3s ease-out',
      }}
    >
      {text}
    </Component>
  )
}
