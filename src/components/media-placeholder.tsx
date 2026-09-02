import { Image as ImageIcon, Video } from 'lucide-react'

import { cn } from '@/lib/utils'

export type PendingMediaType = 'image' | 'video' | 'audio'

export interface PendingMedia {
  type: PendingMediaType
  /** Aspect ratio string, e.g. "16:9" */
  aspectRatio?: string
  /** Size string, e.g. "1024x1024" (used as an aspect-ratio fallback) */
  size?: string
}

// Convert "16:9" / "1024x1024" to a CSS aspect-ratio value ("16 / 9").
function toCssAspectRatio(value?: string): string | undefined {
  if (!value) return undefined
  const match = value.match(/(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)/i)
  if (!match) return undefined
  const w = Number(match[1])
  const h = Number(match[2])
  if (!w || !h) return undefined
  return `${w} / ${h}`
}

export function MediaPlaceholder({
  type,
  aspectRatio,
  size,
  className,
}: PendingMedia & { className?: string }) {
  // Audio has no aspect ratio — render a skeleton of the audio player.
  if (type === 'audio') {
    return (
      <div
        className={cn(
          'flex w-80 max-w-full media-generating items-center gap-3 rounded-full py-2 pr-4 pl-2',
          className,
        )}
      >
        {/* Play button */}
        <div className="size-10 shrink-0 rounded-full bg-muted-foreground/20" />
        {/* Progress bar & time */}
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="h-1.5 w-full rounded-full bg-muted-foreground/20" />
          <div className="flex justify-between">
            <div className="h-2 w-6 rounded bg-muted-foreground/20" />
            <div className="h-2 w-6 rounded bg-muted-foreground/20" />
          </div>
        </div>
        {/* Download button */}
        <div className="size-8 shrink-0 rounded-full bg-muted-foreground/20" />
      </div>
    )
  }

  const ratio =
    toCssAspectRatio(aspectRatio) ??
    toCssAspectRatio(size) ??
    (type === 'video' ? '16 / 9' : '1 / 1')

  const Icon = type === 'video' ? Video : ImageIcon

  return (
    <div
      style={{ aspectRatio: ratio }}
      className={cn(
        'flex w-80 max-w-full media-generating items-center justify-center rounded-lg',
        className,
      )}
    >
      <Icon className="size-8 animate-media-breathe text-muted-foreground" />
    </div>
  )
}
