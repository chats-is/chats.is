'use client';

import type { ChangeEvent } from 'react';
import dynamic from 'next/dynamic';
import type { UseChatHelpers } from '@ai-sdk/react';
import { MessageSquare } from 'lucide-react';

import type { Artifact, Attachment, ChatMessage } from '@/types';
import { cn } from '@/lib/utils';
import { ChatHeader } from '@/components/chat-header';
import {
  ChatPromptForm,
  type ModelOptions
} from '@/components/chat-prompt-form';
import { EmptyScreen } from '@/components/empty-screen';
import { Messages } from '@/components/messages';
import { UsageLimitAlert } from '@/components/usage-limit-alert';

const ScrollToBottom = dynamic(() => import('@/components/scroll-to-bottom'), {
  ssr: false
});

interface ChatPanelProps extends Pick<
  UseChatHelpers<ChatMessage>,
  'messages' | 'setMessages' | 'status' | 'stop'
> {
  title?: string;
  noChat: boolean;
  modelId: string;
  image?: string | null;
  currentModelId: string;
  currentImage?: string | null;
  supportsReasoning?: boolean | null;
  artifacts: Artifact[];
  input: string;
  setInput: (value: string) => void;
  onInputChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (attachments?: Attachment[]) => boolean;
  /** A refused or failed request, rendered at the end of the thread. */
  error?: Error;
  onModelChange: (modelId: string) => void;
  onOptionsChange: (options: ModelOptions) => void;
  onSelectArtifact: (artifactId: string) => void;
  onReload: (message: ChatMessage) => void;
}

export function ChatPanel({
  title,
  noChat,
  modelId,
  image,
  currentModelId,
  currentImage,
  supportsReasoning,
  artifacts,
  messages,
  setMessages,
  status,
  stop,
  input,
  setInput,
  onInputChange,
  onSubmit,
  error,
  onModelChange,
  onOptionsChange,
  onSelectArtifact,
  onReload
}: ChatPanelProps) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <ChatHeader title={title} />
      <div className="min-h-0 w-full flex-1 overflow-hidden">
        <ScrollToBottom status={status} messages={messages}>
          <Messages
            modelId={modelId}
            image={image}
            currentModelId={currentModelId}
            currentImage={currentImage}
            status={status}
            messages={messages}
            setMessages={setMessages}
            reload={onReload}
            supportsReasoning={supportsReasoning}
            artifacts={artifacts}
            onSelectArtifact={onSelectArtifact}
            error={error}
          />
        </ScrollToBottom>
      </div>
      <div
        className={cn('mx-auto w-full max-w-4xl bg-background px-4 pb-4', {
          'mb-60 flex h-full flex-col items-center justify-center': noChat
        })}
      >
        {noChat && (
          <EmptyScreen
            icon={<MessageSquare className="mx-auto mb-4 size-12 opacity-50" />}
            text="How can I help you today?"
          />
        )}
        <UsageLimitAlert />
        <ChatPromptForm
          modelId={currentModelId}
          stop={stop}
          status={status}
          input={input}
          setInput={setInput}
          onInputChange={onInputChange}
          onSubmit={onSubmit}
          onModelChange={onModelChange}
          onOptionsChange={onOptionsChange}
        />
      </div>
    </div>
  );
}
