import { usePreferences } from '@/contexts/preferences-context'
import { Loader2 } from 'lucide-react'

import {
  ChatMessage,
  MediaToolName,
  mediaToolNames,
  MediaToolOutput,
} from '@/types'
import { AudioPlayer } from '@/components/audio-player'
import { MediaLightbox } from '@/components/media-lightbox'
import { MediaPlaceholder } from '@/components/media-placeholder'
import { VideoPlayer } from '@/components/video-player'

export type MediaToolUIPart = Extract<
  ChatMessage['parts'][number],
  { type: `tool-${MediaToolName}` }
>

export function isMediaToolPart(
  part: ChatMessage['parts'][number],
): part is MediaToolUIPart {
  return mediaToolNames.some((name) => part.type === `tool-${name}`)
}

export type TranscribeToolUIPart = Extract<
  ChatMessage['parts'][number],
  { type: 'tool-transcribe_audio' }
>

export function isTranscribeToolPart(
  part: ChatMessage['parts'][number],
): part is TranscribeToolUIPart {
  return part.type === 'tool-transcribe_audio'
}

/**
 * Renders a transcribe_audio tool call: a chip while it works, and nothing
 * afterwards. The transcript is the answer to what was asked, so the model
 * writes it into its reply rather than the UI printing it above — otherwise
 * the same words appear twice, once in a card and once in the sentence that
 * discusses them.
 */
export function TranscribeToolPart({ part }: { part: TranscribeToolUIPart }) {
  if (part.state === 'input-streaming' || part.state === 'input-available') {
    return (
      <div className="my-2 flex w-fit items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span>Transcribing audio…</span>
      </div>
    )
  }

  // A failed tool renders nothing. The model is told what went wrong and says
  // so in its reply, which is a sentence the reader still understands a week
  // later — unlike a chip repeating a provider's wording about a condition
  // that has since passed. The error stays in the part either way: the model
  // needs it on the next turn, and it is what a support question is answered
  // from.
  if (part.state === 'output-error') return null

  if (part.state !== 'output-available' || !part.output) {
    return null
  }

  return null
}

/**
 * Renders a media generation tool call inline in the message stream: a
 * skeleton placeholder while the tool is executing, the media itself once
 * the output arrives, or an error chip.
 */
export function MediaToolPart({ part }: { part: MediaToolUIPart }) {
  const { preferences } = usePreferences()

  const toolName = part.type.slice('tool-'.length) as MediaToolName
  const placeholderType =
    toolName === 'generate_video' || toolName === 'edit_video'
      ? 'video'
      : toolName === 'text_to_speech'
        ? 'audio'
        : 'image'

  if (part.state === 'input-streaming' || part.state === 'input-available') {
    const requestedAspectRatio =
      part.input && typeof part.input === 'object'
        ? (part.input as { aspectRatio?: string }).aspectRatio
        : undefined
    const aspectRatio =
      requestedAspectRatio ??
      (placeholderType === 'video'
        ? preferences.videoAspectRatio
        : preferences.imageAspectRatio)

    return (
      <div className="my-2">
        <MediaPlaceholder
          type={placeholderType}
          aspectRatio={aspectRatio}
          size={placeholderType === 'image' ? preferences.imageSize : undefined}
        />
      </div>
    )
  }

  if (part.state === 'output-error') return null

  if (part.state !== 'output-available' || !part.output) {
    return null
  }

  const output = part.output as MediaToolOutput
  if (output.status === 'error') return null

  if (output.mediaType.startsWith('image/')) {
    return (
      <div className="my-2 max-w-80">
        <MediaLightbox
          type="image"
          src={output.url}
          alt={output.filename || 'Generated image'}
          trigger={
            <img
              className="max-h-96 cursor-zoom-in rounded-lg transition-opacity hover:opacity-90"
              src={output.url}
              alt={output.filename || 'Generated image'}
            />
          }
        />
      </div>
    )
  }

  if (output.mediaType.startsWith('audio/')) {
    return (
      <div className="my-2 w-80 max-w-full">
        <AudioPlayer src={output.url} />
      </div>
    )
  }

  if (output.mediaType.startsWith('video/')) {
    return (
      <div className="my-2 max-w-80">
        <VideoPlayer src={output.url} />
      </div>
    )
  }

  return (
    <a
      href={output.url}
      title={output.filename}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm text-primary underline hover:no-underline"
    >
      Download file
    </a>
  )
}
