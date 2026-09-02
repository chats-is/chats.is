import { useEffect, useState } from 'react'
import { ReasoningUIPart } from 'ai'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Lightbulb, Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { MemoizedReactMarkdown } from '@/components/markdown'

export interface MessageReasoningProps {
  isLoading: boolean
  isWaiting?: boolean
  part: ReasoningUIPart
  reasonDuration?: number
}

const formatReasonDuration = (
  duration?: number,
  options?: {
    allowSubsecond?: boolean
  },
) => {
  if (!duration) return null

  if (options?.allowSubsecond && duration < 1000) {
    const tenths = Math.max(0.1, Math.round(duration / 100) / 10)
    return Number.isInteger(tenths) ? `${tenths}s` : `${tenths.toFixed(1)}s`
  }

  if (duration < 1000) return null

  const totalSeconds = duration / 1000

  if (totalSeconds < 10) {
    const roundedToTenth = Math.round(totalSeconds * 10) / 10
    return Number.isInteger(roundedToTenth)
      ? `${roundedToTenth}s`
      : `${roundedToTenth.toFixed(1)}s`
  }

  if (totalSeconds < 60) {
    return `${Math.round(totalSeconds)}s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)

  return `${minutes}m ${seconds}s`
}

export function MessageReasoning({
  isLoading,
  isWaiting,
  part,
  reasonDuration,
}: MessageReasoningProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [liveDuration, setLiveDuration] = useState(reasonDuration ?? 0)

  const variants = {
    collapsed: {
      height: 0,
      opacity: 0,
    },
    expanded: {
      height: 'auto',
      opacity: 1,
    },
  }

  const text = part.text || (part as any).reasoning || ''
  const hasText = text.trim().length > 0

  // Keep showing if it's loading, if it has text, or if we are still waiting for the first piece of normal text to arrive.
  const showThinking = isLoading || isWaiting
  const showReasoning = hasText || showThinking

  useEffect(() => {
    if (!isLoading) {
      setLiveDuration(reasonDuration ?? 0)
      return
    }

    const startedAt = Date.now()
    const baseDuration = reasonDuration ?? 0

    setLiveDuration(baseDuration)

    const intervalId = window.setInterval(() => {
      setLiveDuration(baseDuration + (Date.now() - startedAt))
    }, 100)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isLoading, reasonDuration])

  const currentThinkingDurationMs = isLoading
    ? Math.max(liveDuration, 100)
    : undefined

  const durationLabel = formatReasonDuration(
    showThinking ? currentThinkingDurationMs : reasonDuration,
    { allowSubsecond: isLoading },
  )

  if (!showReasoning) {
    return null
  }

  return (
    <div className="mb-2">
      <Button
        variant="link"
        size="sm"
        className="-ml-1 flex items-center gap-1 px-0 text-sm font-normal text-muted-foreground shadow-none hover:text-accent-foreground hover:no-underline disabled:opacity-100 has-[>svg]:px-0"
        onClick={() => {
          setIsExpanded(!isExpanded)
        }}
        disabled={!hasText}
      >
        {showThinking ? (
          <>
            <Loader2 className="animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">
              {durationLabel ? `Thinking ${durationLabel}` : 'Thinking...'}
            </span>
          </>
        ) : (
          <>
            <Lightbulb />
            <span>
              {durationLabel ? `Thoughts ${durationLabel}` : 'Thoughts'}
            </span>
            <ChevronDown
              className={cn('transition-transform', {
                'rotate-180': isExpanded,
              })}
            />
          </>
        )}
      </Button>
      <AnimatePresence initial={false}>
        {isExpanded && hasText && (
          <motion.div
            key="reasoning"
            className="ml-[3px] border-l-2 pl-3 text-sm text-muted-foreground"
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            variants={variants}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            <MemoizedReactMarkdown>{text}</MemoizedReactMarkdown>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
