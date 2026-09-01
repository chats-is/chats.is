import React, { useMemo } from 'react';
import { UseChatHelpers } from '@ai-sdk/react';
import { User } from 'lucide-react';

import { Artifact, ChatMessage } from '@/types';
import { cn } from '@/lib/utils';
import { IconLoading } from '@/components/ui/icons';
import { DocumentPreview } from '@/components/artifacts/document-preview';
import { AudioPlayer } from '@/components/audio-player';
import { MediaLightbox } from '@/components/media-lightbox';
import {
  isMediaToolPart,
  isTranscribeToolPart,
  MediaToolPart,
  TranscribeToolPart
} from '@/components/media-tool-part';
import { MessageIncomplete } from '@/components/message-error';
import { MessageMarkdown } from '@/components/message-markdown';
import { MessageReasoning } from '@/components/message-reasoning';
import { ModelIcon } from '@/components/model-icon';
import { VideoPlayer } from '@/components/video-player';

export interface MessageProps extends Partial<
  Pick<UseChatHelpers<ChatMessage>, 'status'>
> {
  message: ChatMessage;
  image?: string | null;
  isLastMessage?: boolean;
  supportsReasoning?: boolean | null;
  hasVisibleArtifacts?: boolean;
  // Artifacts this message produced, rendered inline at the position of their
  // create_artifact tool call.
  artifacts?: Artifact[];
  onSelectArtifact?: (id: string) => void;
  children: React.ReactNode;
}

export function Message({
  status,
  message,
  image,
  isLastMessage,
  supportsReasoning,
  hasVisibleArtifacts = false,
  artifacts,
  onSelectArtifact,
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
  const hasMediaToolPart = message.parts.some(
    part => isMediaToolPart(part) || isTranscribeToolPart(part)
  );
  const firstReasoningIndex = message.parts.findIndex(
    part => part.type === 'reasoning'
  );
  const lastReasoningIndex = (() => {
    for (let index = message.parts.length - 1; index >= 0; index -= 1) {
      if (message.parts[index]?.type === 'reasoning') {
        return index;
      }
    }

    return -1;
  })();
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
  const showReasoningLoading =
    isLastMessage === true &&
    lastReasoningIndex === message.parts.length - 1 &&
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

  // Match each create_artifact tool call (by its position in `parts`) to the
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
      if (part.type !== 'tool-create_artifact') return;
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

  const renderArtifactCard = (artifact: Artifact) => (
    <div className="my-2">
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
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted select-none">
          {message.role === 'user' && <User className="size-5" />}
          {message.role === 'assistant' && <ModelIcon image={image} />}
        </div>
        <div
          className={cn(
            'flex min-h-9 flex-1 flex-col justify-center overflow-hidden px-1',
            message.role === 'user' ? 'mr-3 items-end' : 'ml-3 items-start'
          )}
        >
          <div
            className={cn(
              message.role === 'user'
                ? 'ml-12 rounded-2xl bg-muted px-3 py-1.5'
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

              // A turn that failed — refused before it began, or cut off part
              // way. The reason was shown while it happened; what is left in
              // the thread is that nothing came back.
              if (part.type === 'data-error') {
                return <MessageIncomplete key={index} />;
              }

              if (part.type === 'tool-create_artifact') {
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
                  />
                );
              }

              if (part.type === 'text') {
                return message.role === 'user' ? (
                  <p key={index} className="whitespace-pre-wrap">
                    {part.text.split('\n').map((line, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && <br />}
                        {line}
                      </React.Fragment>
                    ))}
                  </p>
                ) : (
                  <MessageMarkdown key={index} content={part.text} />
                );
              }

              if (part.type === 'file') {
                // Render image
                if (part.mediaType.startsWith('image/')) {
                  return (
                    <div key={index} className="my-2 max-w-80">
                      <MediaLightbox
                        type="image"
                        src={part.url}
                        alt={part.filename || 'Generated image'}
                        trigger={
                          <img
                            className="max-h-96 cursor-zoom-in rounded-lg transition-opacity hover:opacity-90"
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
                    <div key={index} className="my-2 w-80 max-w-full">
                      <AudioPlayer src={part.url} />
                    </div>
                  );
                }

                // Render video
                if (part.mediaType.startsWith('video/')) {
                  return (
                    <div key={index} className="my-2 max-w-80">
                      <VideoPlayer src={part.url} />
                    </div>
                  );
                }

                // Display download link for other file types
                return (
                  <a
                    key={index}
                    href={part.url}
                    title={part.filename}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary underline hover:no-underline"
                  >
                    Download file
                  </a>
                );
              }
            })}
            {unpositionedArtifacts.map(artifact => (
              <React.Fragment key={artifact.id}>
                {renderArtifactCard(artifact)}
              </React.Fragment>
            ))}
            {status === 'streaming' &&
              isLastMessage &&
              !hasVisibleArtifacts &&
              !hasReasoningPart &&
              !hasVisibleTextContent &&
              !hasFilePart &&
              !hasMediaToolPart &&
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
        </div>
      </div>
      {children}
    </div>
  );
}
