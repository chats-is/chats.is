'use client';

import { usePreferences } from '@/contexts/preferences-context';
import { Captions, CircleAlert, Loader2 } from 'lucide-react';

import {
  ChatMessage,
  MediaToolName,
  mediaToolNames,
  MediaToolOutput,
  TranscribeToolOutput
} from '@/types';
import { AudioPlayer } from '@/components/audio-player';
import { MediaLightbox } from '@/components/media-lightbox';
import { MediaPlaceholder } from '@/components/media-placeholder';
import { VideoPlayer } from '@/components/video-player';

export type MediaToolUIPart = Extract<
  ChatMessage['parts'][number],
  { type: `tool-${MediaToolName}` }
>;

export function isMediaToolPart(
  part: ChatMessage['parts'][number]
): part is MediaToolUIPart {
  return mediaToolNames.some(name => part.type === `tool-${name}`);
}

export type TranscribeToolUIPart = Extract<
  ChatMessage['parts'][number],
  { type: 'tool-transcribe_audio' }
>;

export function isTranscribeToolPart(
  part: ChatMessage['parts'][number]
): part is TranscribeToolUIPart {
  return part.type === 'tool-transcribe_audio';
}

/**
 * Renders a transcribe_audio tool call: a working chip while transcribing,
 * the transcript as a quoted block once done, or an error chip.
 */
export function TranscribeToolPart({ part }: { part: TranscribeToolUIPart }) {
  if (part.state === 'input-streaming' || part.state === 'input-available') {
    return (
      <div className="my-2 flex w-fit items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span>Transcribing audio…</span>
      </div>
    );
  }

  if (part.state === 'output-error') {
    return <MediaToolError message={part.errorText} />;
  }

  if (part.state !== 'output-available' || !part.output) {
    return null;
  }

  const output = part.output as TranscribeToolOutput;
  if (output.status === 'error') {
    return <MediaToolError message={output.message} />;
  }

  return (
    <div className="my-2 rounded-lg border bg-muted/30 px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Captions className="size-3.5" />
        Transcript
      </div>
      <p className="text-sm whitespace-pre-wrap">{output.text}</p>
    </div>
  );
}

function MediaToolError({ message }: { message?: string }) {
  return (
    <div className="my-2 flex w-fit items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <CircleAlert className="size-4 shrink-0" />
      <span>{message || 'Generation failed.'}</span>
    </div>
  );
}

/**
 * Renders a media generation tool call inline in the message stream: a
 * skeleton placeholder while the tool is executing, the media itself once
 * the output arrives, or an error chip.
 */
export function MediaToolPart({ part }: { part: MediaToolUIPart }) {
  const { preferences } = usePreferences();

  const toolName = part.type.slice('tool-'.length) as MediaToolName;
  const placeholderType =
    toolName === 'generate_video'
      ? 'video'
      : toolName === 'text_to_speech'
        ? 'audio'
        : 'image';

  if (part.state === 'input-streaming' || part.state === 'input-available') {
    const requestedAspectRatio =
      part.input && typeof part.input === 'object'
        ? (part.input as { aspectRatio?: string }).aspectRatio
        : undefined;
    const aspectRatio =
      requestedAspectRatio ??
      (placeholderType === 'video'
        ? preferences.videoAspectRatio
        : preferences.imageAspectRatio);

    return (
      <div className="my-2">
        <MediaPlaceholder
          type={placeholderType}
          aspectRatio={aspectRatio}
          size={placeholderType === 'image' ? preferences.imageSize : undefined}
        />
      </div>
    );
  }

  if (part.state === 'output-error') {
    return <MediaToolError message={part.errorText} />;
  }

  if (part.state !== 'output-available' || !part.output) {
    return null;
  }

  const output = part.output as MediaToolOutput;
  if (output.status === 'error') {
    return <MediaToolError message={output.message} />;
  }

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
    );
  }

  if (output.mediaType.startsWith('audio/')) {
    return (
      <div className="my-2 w-80 max-w-full">
        <AudioPlayer src={output.url} />
      </div>
    );
  }

  if (output.mediaType.startsWith('video/')) {
    return (
      <div className="my-2 max-w-80">
        <VideoPlayer src={output.url} />
      </div>
    );
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
  );
}
