import React, { useMemo } from 'react';
import { type UseChatHelpers } from '@ai-sdk/react';
import { User } from 'lucide-react';

import { type Artifact, type ChatMessage } from '@/types';
import { textRuns } from '@/lib/message-content';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { DocumentPreview } from '@/components/artifacts/document-preview';
import { AudioPlayer } from '@/components/audio-player';
import { FileTypeIcon } from '@/components/file-type-icon';
import { IconLoading } from '@/components/icons';
import { MediaLightbox } from '@/components/media-lightbox';
import {
  isMediaToolPart,
  isTranscribeToolPart,
  MediaToolPart,
  TranscribeToolPart
} from '@/components/media-tool-part';
import { MessageError, MessageIncomplete } from '@/components/message-error';
import { MessageMarkdown } from '@/components/message-markdown';
import { MessageReasoning } from '@/components/message-reasoning';
import { ModelIcon } from '@/components/model-icon';
import { VideoPlayer } from '@/components/video-player';
import {
  collectSources,
  isWebSearchPart,
  MessageSources,
  WebSearchBlock
} from '@/components/web-search-part';

export interface MessageProps extends Partial<
  Pick<UseChatHelpers<ChatMessage>, 'status'>
> {
  message: ChatMessage;
  image?: string | null;
  /** A shared chat: read by anyone, changed by no one. It is drawn without
   *  avatars — it knows a model's name and not its icon, so the assistant's
   *  was an empty circle, and which side a message sits on says whose it is. */
  isReadonly?: boolean;
  isLastMessage?: boolean;
  supportsReasoning?: boolean | null;
  hasVisibleArtifacts?: boolean;
  // Artifacts this message produced, rendered inline at the position of the
  // tool call that made each — create_artifact or update_artifact.
  artifacts?: Artifact[];
  onSelectArtifact?: (id: string) => void;
  /** Refused while the chat was open: its reason is shown, not just that
   *  nothing came back. */
  refusedHere?: boolean;
  children: React.ReactNode;
}

/** A call that makes an artifact, and so has a card where it was made. */
const isArtifactToolPart = (part: ChatMessage['parts'][number]) =>
  part.type === 'tool-create_artifact' || part.type === 'tool-update_artifact';

export function Message({
  status,
  message,
  image,
  isReadonly,
  isLastMessage,
  supportsReasoning,
  hasVisibleArtifacts = false,
  artifacts,
  onSelectArtifact,
  refusedHere,
  children
}: MessageProps) {
  const hasVisibleTextContent = message.parts.some(
    part =>
      part.type === 'text' &&
      (part.text.trim().length > 0 || part.state === 'streaming')
  );
  const reasoningParts = message.parts.filter(
    part => part.type === 'reasoning'
  );
  const hasReasoningPart = reasoningParts.length > 0;
  const hasFilePart = message.parts.some(part => part.type === 'file');
  // What goes in a user's bubble: their words, and the passage they are about.
  const hasUserWords = message.parts.some(
    part =>
      (part.type === 'text' && part.text.trim().length > 0) ||
      (part.type === 'data-artifactRef' && !!part.data.selection)
  );
  // A refusal or a failure is the whole of the reply: nothing is on its way
  // after it, so nothing waits as if it were.
  const hasErrorPart = message.parts.some(part => part.type === 'data-error');
  const hasMediaToolPart = message.parts.some(
    part =>
      isMediaToolPart(part) ||
      isTranscribeToolPart(part) ||
      isWebSearchPart(part)
  );
  const sources = useMemo(() => collectSources(message.parts), [message.parts]);
  const runs = useMemo(() => textRuns(message.parts), [message.parts]);
  // The searches are shown as one block, where the first of them was made —
  // as the reasoning parts are, and for the same reason: several at once are
  // one thing happening, not several.
  const webSearchParts = message.parts.filter(isWebSearchPart);
  const firstWebSearchIndex = message.parts.findIndex(isWebSearchPart);
  const firstReasoningIndex = message.parts.findIndex(
    part => part.type === 'reasoning'
  );
  const mergedReasoningText = reasoningParts
    .map(part => part.text || (part as any).reasoning || '')
    .join('\n')
    .trim();
  const mergedReasoningPart = hasReasoningPart
    ? ({
        ...reasoningParts[0],
        text: mergedReasoningText,
        state: reasoningParts.some(part => part.state === 'streaming')
          ? 'streaming'
          : 'done'
      } as any)
    : null;
  // Thinking is under way until the answer itself begins, while the reply is
  // still being written. A model that thinks, searches and thinks again is
  // thinking all the while — the thoughts are one block, and it stays open
  // through the search rather than closing and opening again. A turn stopped
  // or cut off in its thinking is shown finished, closed, not thinking for
  // ever.
  const showReasoningLoading =
    status === 'streaming' &&
    isLastMessage === true &&
    hasReasoningPart &&
    !hasVisibleTextContent &&
    !hasVisibleArtifacts;
  const hasVisibleReasoningDisplay =
    hasReasoningPart &&
    (mergedReasoningText.length > 0 || showReasoningLoading);
  const showSubmittedAssistantLoading =
    message.role === 'assistant' &&
    status === 'submitted' &&
    isLastMessage === true &&
    !hasVisibleArtifacts &&
    !hasVisibleReasoningDisplay &&
    !hasVisibleTextContent &&
    !hasFilePart &&
    !hasMediaToolPart;

  // Match each artifact tool call (by its position in `parts`) to the
  // artifact it produced, so the card renders inline exactly where the model
  // generated it. Two passes: id matches first (settled/persisted parts carry
  // `output.id`), then leftover artifacts fill the unmatched tool parts in
  // creation order — so one temporarily-missing artifact (e.g. mid-refetch)
  // can't shift a sibling onto the wrong call. Memoized: this runs for every
  // mounted message on each streaming delta.
  const { partArtifact, unpositionedArtifacts } = useMemo(() => {
    const messageArtifacts = artifacts ?? [];
    const artifactsById = new Map(messageArtifacts.map(a => [a.id, a]));
    const orderedArtifacts = [...messageArtifacts].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );
    const matched = new Map<number, Artifact>();
    const usedArtifactIds = new Set<string>();
    const fallbackPartIndexes: number[] = [];

    message.parts.forEach((part, index) => {
      if (!isArtifactToolPart(part)) return;
      const outputId = (part as any).output?.id as string | undefined;
      const artifact = outputId ? artifactsById.get(outputId) : undefined;
      if (artifact && !usedArtifactIds.has(artifact.id)) {
        matched.set(index, artifact);
        usedArtifactIds.add(artifact.id);
      } else {
        fallbackPartIndexes.push(index);
      }
    });

    const remaining = orderedArtifacts.filter(a => !usedArtifactIds.has(a.id));
    fallbackPartIndexes.forEach((partIndex, i) => {
      const artifact = remaining[i];
      if (artifact) {
        matched.set(partIndex, artifact);
        usedArtifactIds.add(artifact.id);
      }
    });

    return {
      partArtifact: matched,
      unpositionedArtifacts: orderedArtifacts.filter(
        a => !usedArtifactIds.has(a.id)
      )
    };
  }, [message.parts, artifacts]);

  // A file the message carries: an image, a sound, a video, or any other
  // file by its name. What the user attached is drawn smaller than what a
  // reply made — it is what they sent along, not the answer: an image as a
  // square thumbnail that opens full size, a video small but still playable.
  // Whatever a file is, it keeps its room below and none above, so one that
  // opens a message stands level with the avatar.
  const renderFilePart = (
    part: Extract<ChatMessage['parts'][number], { type: 'file' }>,
    index: number
  ) => {
    const attached = message.role === 'user';
    // Render image
    if (part.mediaType.startsWith('image/')) {
      return (
        <div key={index} className={cn('mb-2', !attached && 'max-w-80')}>
          <MediaLightbox
            type="image"
            src={part.url}
            alt={part.filename || 'Generated image'}
            trigger={
              <img
                className={cn(
                  'cursor-zoom-in rounded-lg transition-opacity hover:opacity-90',
                  attached ? 'size-20 object-cover' : 'max-h-96'
                )}
                src={part.url}
                alt={part.filename || 'Generated image'}
              />
            }
          />
        </div>
      );
    }

    // Render audio
    if (part.mediaType.startsWith('audio/')) {
      return (
        <div key={index} className="mb-2 w-80 max-w-full">
          <AudioPlayer src={part.url} />
        </div>
      );
    }

    // Render video
    if (part.mediaType.startsWith('video/')) {
      return (
        <div
          key={index}
          className={cn('mb-2', attached ? 'max-w-60' : 'max-w-80')}
        >
          <VideoPlayer src={part.url} />
        </div>
      );
    }

    // A document, or any other file: its name, opening the file.
    // As wide as its name, up to a limit, and inline — so the
    // files of one message sit side by side.
    return (
      <Tooltip key={index}>
        <TooltipTrigger asChild>
          <a
            href={part.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex max-w-60 items-center gap-2 rounded-lg border bg-background px-3 py-2 align-top text-sm hover:bg-muted',
              'mb-2',
              !attached && 'mr-2'
            )}
          >
            <FileTypeIcon
              contentType={part.mediaType}
              className="size-4 shrink-0 text-muted-foreground/60"
            />
            <span className="min-w-0 truncate">{part.filename || 'File'}</span>
          </a>
        </TooltipTrigger>
        <TooltipContent>{part.filename || 'File'}</TooltipContent>
      </Tooltip>
    );
  };

  const renderArtifactCard = (artifact: Artifact) => (
    <div className="mb-2">
      <DocumentPreview
        artifact={artifact}
        onOpen={onSelectArtifact}
        showDownloadButton={true}
      />
    </div>
  );

  return (
    <div
      tabIndex={0}
      className="group mb-1 rounded-md last:mb-0 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden"
    >
      <div
        className={cn('flex items-start', {
          'flex-row-reverse': message.role === 'user'
        })}
      >
        {!isReadonly && (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted select-none">
            {message.role === 'user' && <User className="size-5" />}
            {message.role === 'assistant' && <ModelIcon image={image} />}
          </div>
        )}
        <div
          className={cn(
            'flex min-h-9 flex-1 flex-col justify-center overflow-hidden px-1',
            message.role === 'user' ? 'items-end' : 'items-start',
            // The gap is the avatar's, and goes with it.
            !isReadonly && (message.role === 'user' ? 'mr-3' : 'ml-3')
          )}
        >
          {/* What the user attached, on a line of its own above their words,
              to the right as the message is — not inside the bubble. */}
          {message.role === 'user' && hasFilePart && (
            <div className="flex flex-wrap justify-end gap-x-2">
              {message.parts.map((part, index) =>
                part.type === 'file' ? renderFilePart(part, index) : null
              )}
            </div>
          )}
          {/* A user's words in a bubble as wide as they are, up to most of
              the row; one that only carried files has none. */}
          {(message.role !== 'user' || hasUserWords) && (
            <div
              className={cn(
                message.role === 'user'
                  ? 'max-w-[80%] rounded-2xl bg-muted px-3 py-1.5'
                  : 'w-full pr-12'
              )}
            >
              {message.parts.map((part, index) => {
                if (isMediaToolPart(part)) {
                  return <MediaToolPart key={index} part={part} />;
                }

                if (isTranscribeToolPart(part)) {
                  return <TranscribeToolPart key={index} part={part} />;
                }

                if (isWebSearchPart(part)) {
                  return index === firstWebSearchIndex ? (
                    <WebSearchBlock key={index} parts={webSearchParts} />
                  ) : null;
                }

                // A turn that failed — refused before it began, or cut off part
                // way. Refused just now, the reason is what to act on, so it is
                // shown; read back later, what is left is that nothing came
                // back.
                if (part.type === 'data-error') {
                  return refusedHere ? (
                    <MessageError key={index} message={part.data.message} />
                  ) : (
                    <MessageIncomplete key={index} />
                  );
                }

                if (isArtifactToolPart(part)) {
                  const artifact = partArtifact.get(index);
                  return artifact ? (
                    <React.Fragment key={index}>
                      {renderArtifactCard(artifact)}
                    </React.Fragment>
                  ) : null;
                }

                if (part.type === 'reasoning') {
                  if (index !== firstReasoningIndex || !mergedReasoningPart) {
                    return null;
                  }

                  return (
                    <MessageReasoning
                      key={index}
                      part={mergedReasoningPart}
                      reasonDuration={message.metadata?.reasonDuration}
                      isLoading={showReasoningLoading}
                      isThinking={
                        showReasoningLoading &&
                        message.parts[message.parts.length - 1]?.type ===
                          'reasoning'
                      }
                    />
                  );
                }

                // The passage a request is about, above it, as the reader
                // chose it in the artifact.
                if (part.type === 'data-artifactRef') {
                  return part.data.selection ? (
                    <p
                      key={index}
                      className="my-1 line-clamp-3 border-l-2 border-muted-foreground/30 pl-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground"
                    >
                      {part.data.selection}
                    </p>
                  ) : null;
                }

                if (part.type === 'text') {
                  if (message.role === 'user') {
                    return (
                      <p key={index} className="whitespace-pre-wrap">
                        {part.text.split('\n').map((line, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && <br />}
                            {line}
                          </React.Fragment>
                        ))}
                      </p>
                    );
                  }
                  // Drawn once, at the start of the piece it belongs to.
                  const run = runs.get(index);
                  return run ? (
                    <MessageMarkdown
                      key={index}
                      content={run.text}
                      streaming={run.streaming}
                    />
                  ) : null;
                }

                if (part.type === 'file') {
                  return message.role === 'user'
                    ? null
                    : renderFilePart(part, index);
                }
              })}
              {unpositionedArtifacts.map(artifact => (
                <React.Fragment key={artifact.id}>
                  {renderArtifactCard(artifact)}
                </React.Fragment>
              ))}
              {message.role === 'assistant' && status !== 'streaming' && (
                <MessageSources sources={sources} />
              )}
              {status === 'streaming' &&
                isLastMessage &&
                !hasVisibleArtifacts &&
                !hasReasoningPart &&
                !hasVisibleTextContent &&
                !hasFilePart &&
                !hasMediaToolPart &&
                !hasErrorPart &&
                (supportsReasoning ? (
                  <MessageReasoning
                    isLoading={false}
                    isWaiting={true}
                    part={{ type: 'reasoning', text: '' } as any}
                    reasonDuration={message.metadata?.reasonDuration}
                  />
                ) : (
                  <div className="my-1">
                    <IconLoading className="text-muted-foreground" />
                  </div>
                ))}
              {showSubmittedAssistantLoading && (
                <div className="my-1">
                  <IconLoading className="text-muted-foreground" />
                </div>
              )}
              {status === 'streaming' &&
                isLastMessage &&
                !hasVisibleArtifacts &&
                !hasVisibleReasoningDisplay &&
                !hasVisibleTextContent &&
                !hasFilePart &&
                !hasMediaToolPart &&
                hasReasoningPart && (
                  <div className="my-1">
                    <IconLoading className="text-muted-foreground" />
                  </div>
                )}
            </div>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
