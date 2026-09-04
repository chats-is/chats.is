import { type ChangeEvent, type ComponentProps } from 'react';
import { ClientOnly } from '@tanstack/react-router';
import { type UseChatHelpers } from '@ai-sdk/react';
import { MessageSquare } from 'lucide-react';

import { type Artifact, type Attachment, type ChatMessage } from '@/types';
import { cn } from '@/lib/utils';
import { ChatHeader } from '@/components/chat-header';
import {
  ChatPromptForm,
  type ModelOptions
} from '@/components/chat-prompt-form';
import { EmptyScreen } from '@/components/empty-screen';
import { Messages } from '@/components/messages';
import { PromptSuggestions } from '@/components/prompt-suggestions';
import ScrollContainer from '@/components/scroll-to-bottom';
import { UsageLimitAlert } from '@/components/usage-limit-alert';

// react-scroll-to-bottom measures the scroll container, so it can only run in
// the browser — which is the whole of the constraint, and ClientOnly is the
// whole of the answer. Keeping the wrapper's own signature means the call site
// below reads exactly as it did.
function ScrollToBottom(props: ComponentProps<typeof ScrollContainer>) {
  return (
    <ClientOnly>
      <ScrollContainer {...props} />
    </ClientOnly>
  );
}

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
      <div
        className={cn('min-h-0 w-full flex-1 overflow-hidden', {
          // Nothing to show — `noChat` means a ready status and zero messages —
          // and a flexing empty region would push the composer down the page.
          hidden: noChat
        })}
      >
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
          // Anchored from the top rather than centred: the prompt suggestions
          // below are optional and variable in height, and centring would let
          // them shove the greeting and the composer up the page.
          //
          // It also takes over as the scroll region under the fixed header, the
          // way the thread does in a conversation — the greeting, the composer
          // and the suggestions scroll together when the window is too short to
          // hold them, rather than being clipped by the ancestor.
          'flex min-h-0 flex-1 flex-col items-center overflow-y-auto pt-[max(3rem,14vh)]':
            noChat
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
        {/* Only on a new chat: a prompt seeds the first message, so once the
            conversation has started it is no longer what the user needs. */}
        {noChat && (
          <PromptSuggestions
            currentValue={input}
            onInsert={setInput}
            disabled={status === 'submitted' || status === 'streaming'}
          />
        )}
      </div>
    </div>
  );
}
