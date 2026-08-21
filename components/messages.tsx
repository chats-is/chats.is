'use client';

import * as React from 'react';
import { UseChatHelpers } from '@ai-sdk/react';

import { Artifact, ChatMessage } from '@/types';
import { cn } from '@/lib/utils';
import { Message } from '@/components/message';
import { MessageActions } from '@/components/message-actions';
import {
  chatRequestErrorMessage,
  MessageError
} from '@/components/message-error';
import { MessageLoading } from '@/components/message-loading';

export interface MessagesProps
  extends
    Partial<Pick<UseChatHelpers<ChatMessage>, 'status' | 'setMessages'>>,
    Pick<UseChatHelpers<ChatMessage>, 'messages'> {
  /** Display model (for existing messages) */
  modelId: string;
  /** Display image (for existing messages) */
  image?: string | null;
  /** Current selected model (for regenerate) */
  currentModelId?: string;
  /** Current image (for loading) */
  currentImage?: string | null;
  reload?: (message: ChatMessage) => void;
  isReadonly?: boolean;
  supportsReasoning?: boolean | null;
  className?: string;
  artifacts?: Artifact[];
  onSelectArtifact?: (id: string) => void;
  /**
   * A request the server refused, or that failed in flight. Rendered at the end
   * of the thread rather than as a toast: it belongs next to the message it
   * answers, and a toast for "you are over your quota" is gone before the user
   * can act on it.
   */
  error?: Error;
  /** Describes the media being generated, to show a shaped loading placeholder. */
}

export function Messages({
  modelId,
  image,
  currentModelId,
  currentImage,
  status,
  reload,
  messages,
  setMessages,
  isReadonly,
  supportsReasoning,
  className,
  artifacts,
  onSelectArtifact,
  error
}: MessagesProps) {
  if (!messages.length) {
    return null;
  }

  const getReasoningText = (message: ChatMessage) =>
    message.parts
      .filter(part => part.type === 'reasoning')
      .map(part => part.text || (part as any).reasoning || '')
      .join('\n')
      .trim();

  const hasVisibleMessageContent = (message: ChatMessage) => {
    return message.parts.some(part => {
      if (part.type === 'text') {
        return part.text.trim().length > 0 || part.state === 'streaming';
      }

      if (part.type === 'reasoning') {
        return getReasoningText(message).length > 0;
      }

      // A refused turn's only part. Without this the message is dropped as
      // empty and the refusal is stored but never seen.
      if (part.type === 'data-error') {
        return true;
      }

      return part.type === 'file';
    });
  };

  const hasVisibleArtifactContent = (artifact: Artifact) => {
    if (artifact.type === 'image' || artifact.type === 'file') {
      return Boolean(artifact.fileUrl);
    }

    return (artifact.content ?? '').length > 0;
  };

  // One card per artifact, under the message that created it, showing the
  // artifact's CURRENT (latest) content. Older versions are reached via the
  // canvas version dropdown — so the inline card always matches what opens.
  const artifactsByMessage = artifacts?.reduce<Record<string, Artifact[]>>(
    (acc, artifact) => {
      if (!artifact.messageId) return acc;
      acc[artifact.messageId] ||= [];
      acc[artifact.messageId].push(artifact);
      return acc;
    },
    {}
  );

  const displayItems: Array<{
    kind: 'message';
    message: ChatMessage;
    index: number;
    artifacts: Artifact[];
    hasVisibleArtifacts: boolean;
    showActions?: boolean;
  }> = [];

  messages.forEach((message, index) => {
    const messageArtifacts = message.id
      ? (artifactsByMessage?.[message.id] ?? [])
      : [];
    const hasMessageContent = hasVisibleMessageContent(message);
    const hasRenderableArtifacts = messageArtifacts.some(
      hasVisibleArtifactContent
    );
    const isPendingAssistantPlaceholder =
      message.role === 'assistant' &&
      !hasMessageContent &&
      !hasRenderableArtifacts &&
      index === messages.length - 1 &&
      (status === 'submitted' || status === 'streaming');

    const shouldRenderMessage =
      message.role !== 'assistant' ||
      hasMessageContent ||
      hasRenderableArtifacts ||
      isPendingAssistantPlaceholder;

    if (!shouldRenderMessage) {
      return;
    }

    displayItems.push({
      kind: 'message',
      message,
      index,
      artifacts: messageArtifacts,
      hasVisibleArtifacts: hasRenderableArtifacts,
      showActions: true
    });
  });

  return (
    <div className={cn('mx-auto w-full max-w-4xl flex-1 px-4 py-6', className)}>
      {displayItems.map((item, visibleIndex) => {
        const {
          message,
          index,
          artifacts: messageArtifacts,
          hasVisibleArtifacts,
          showActions
        } = item;
        const isLastMessage = visibleIndex === displayItems.length - 1;
        const messageKey = message.id || `${message.role}-${index}`;

        return (
          <div key={messageKey}>
            <Message
              status={status}
              message={message}
              image={image}
              isLastMessage={isLastMessage}
              supportsReasoning={supportsReasoning}
              hasVisibleArtifacts={hasVisibleArtifacts}
              artifacts={messageArtifacts}
              onSelectArtifact={onSelectArtifact}
            >
              {showActions !== false && (
                <MessageActions
                  modelId={currentModelId || modelId}
                  status={status}
                  reload={reload}
                  message={message}
                  setMessages={setMessages}
                  isLastMessage={isLastMessage}
                  isReadonly={isReadonly}
                />
              )}
            </Message>
          </div>
        );
      })}

      {status === 'submitted' &&
        displayItems[displayItems.length - 1]?.message.role !== 'assistant' && (
          <MessageLoading image={currentImage || image} />
        )}

      {error && <MessageError message={chatRequestErrorMessage(error)} />}
    </div>
  );
}
