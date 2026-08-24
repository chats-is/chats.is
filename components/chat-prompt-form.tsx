import { useCallback, useState } from 'react';
import { useSystemSettings } from '@/contexts/system-settings-context';
import { UseChatHelpers } from '@ai-sdk/react';
import { ArrowUp, Loader2, Square } from 'lucide-react';
import Textarea from 'react-textarea-autosize';

import { Attachment, ChatMessage } from '@/types';
import { modelMatchesId } from '@/lib/utils';
import { useEnterSubmit } from '@/hooks/use-enter-submit';
import { Button } from '@/components/ui/button';
import { AttachmentsPreview } from '@/components/attachments-preview';
import { MediaSettingsMenu } from '@/components/media-settings-menu';
import { ModelMenu, ModelOptions } from '@/components/model-menu';
import { UploadButton } from '@/components/upload-button';

export type { ModelOptions };

export interface ChatPromptFormProps extends Pick<
  UseChatHelpers<ChatMessage>,
  'status' | 'stop'
> {
  /** Current model value */
  modelId: string;
  input: string;
  setInput: (value: string) => void;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  /** Returns false when the message was refused (no resolvable model). */
  onSubmit: (attachments?: Attachment[]) => boolean;
  /** Callback when model changes */
  onModelChange: (model: string) => void;
  /** Callback when model options change (like reasoning toggle) */
  onOptionsChange?: (options: ModelOptions) => void;
}

export function ChatPromptForm({
  modelId,
  status,
  stop,
  input,
  setInput,
  onInputChange,
  onSubmit,
  onModelChange,
  onOptionsChange
}: ChatPromptFormProps) {
  const { formRef, onKeyDown } = useEnterSubmit();
  const [uploadQueue, setUploadQueue] = useState<Array<string>>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOptions>({});

  const { chatModels, sttModels } = useSystemSettings();

  // Two distinct dead ends, both of which make a submission fail:
  //   - no chat model is configured at all;
  //   - one exists but none is selected. `preferences.chatModelId` falls back
  //     to '' when the admin has not set `default.chatModelId`, and a stale
  //     preference can also name a model that no longer resolves. Either way
  //     the request would reach /api/chat with an empty or unknown modelId and
  //     come back as an opaque 400/403. Alias-aware, since that is how the
  //     server resolves a modelId.
  const noModels = !chatModels || chatModels.length === 0;
  const noModelSelected =
    !noModels && !chatModels.some(model => modelMatchesId(model, modelId));
  const cannotSend = noModels || noModelSelected;

  // Say which dead end it is: with models available the user can fix it right
  // here from the model menu, so the input should point at it rather than just
  // going inert.
  const placeholder = noModels
    ? 'No models available.'
    : noModelSelected
      ? 'Select a model to start.'
      : 'Send a message.';

  // Attachments: images need a vision-capable chat model, audio needs an STT
  // model to transcribe it. The `+` menu settles *which* STT model when the
  // user picks that row, so existence is enough here.
  const canAttachImages = !!modelOptions.supportsVision;
  const canAttachAudio = !!sttModels?.length;
  const showAttachments = canAttachImages || canAttachAudio;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Clear only once the message is actually on its way — onSubmit refuses
    // when no model resolves, and wiping the draft anyway would throw away
    // what the user typed along with any uploaded attachments.
    if (!onSubmit(attachments)) return;
    setInput('');
    setAttachments([]);
  };

  const handleOptionsChange = useCallback(
    (options: ModelOptions) => {
      setModelOptions(options);
      // Propagate to parent for isReasoning tracking
      onOptionsChange?.(options);
    },
    [onOptionsChange]
  );

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="w-full">
      {showAttachments && (
        <AttachmentsPreview
          disabled={status === 'submitted' || status === 'streaming'}
          uploadQueue={uploadQueue}
          attachments={attachments}
          setAttachments={setAttachments}
        />
      )}
      <div className="w-full rounded-2xl border bg-background p-4 shadow-md">
        <div className="relative flex w-full items-start space-x-2">
          <Textarea
            autoFocus
            required
            tabIndex={0}
            spellCheck={false}
            placeholder={placeholder}
            className="flex-1 resize-none bg-transparent p-1 focus-within:outline-hidden"
            rows={1}
            minRows={1}
            maxRows={8}
            disabled={
              cannotSend || status === 'submitted' || status === 'streaming'
            }
            value={input}
            onChange={onInputChange}
            onKeyDown={e => {
              if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                const textarea = e.currentTarget;
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const value = textarea.value;
                textarea.value =
                  value.substring(0, start) + '\n' + value.substring(end);
                textarea.selectionStart = textarea.selectionEnd = start + 1;
                setInput(textarea.value);
              } else if (e.key === 'Enter') {
                if (!input.trim()) {
                  e.preventDefault();
                  return;
                }
                onKeyDown(e);
              } else {
                onKeyDown(e);
              }
            }}
          />
        </div>
        <div className="mt-5 flex items-center justify-between space-x-2">
          {/* Upload, the chat model, and how it should make media. */}
          <div className="flex items-center space-x-2">
            <UploadButton
              disabled={status === 'submitted' || status === 'streaming'}
              canAttachImages={canAttachImages}
              uploadQueue={uploadQueue}
              setUploadQueue={setUploadQueue}
              attachments={attachments}
              setAttachments={setAttachments}
            />
            <ModelMenu
              models={chatModels}
              status={status}
              modelId={modelId}
              onModelChange={onModelChange}
              onOptionsChange={handleOptionsChange}
            />
            <MediaSettingsMenu status={status} />
          </div>
          <div className="flex items-center space-x-2">
            {status === 'streaming' ? (
              <Button
                type="button"
                size="icon"
                className="size-9 rounded-full shadow-none"
                onClick={stop}
              >
                <Square className="size-4 fill-current" />
                <span className="sr-only">Stop generating</span>
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                className="size-9 rounded-full shadow-none"
                disabled={
                  cannotSend ||
                  input?.trim() === '' ||
                  status === 'submitted' ||
                  uploadQueue.length > 0
                }
              >
                {status === 'submitted' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
                <span className="sr-only">Send message</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
