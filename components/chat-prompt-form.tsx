import { useCallback, useState } from 'react';
import { usePreferences } from '@/contexts/preferences-context';
import { useSystemSettings } from '@/contexts/system-settings-context';
import { UseChatHelpers } from '@ai-sdk/react';
import { ArrowUp, Loader2, Square } from 'lucide-react';
import Textarea from 'react-textarea-autosize';

import { Attachment, ChatMessage } from '@/types';
import { useEnterSubmit } from '@/hooks/use-enter-submit';
import { Button } from '@/components/ui/button';
import { AttachmentsButton } from '@/components/attachments-button';
import { AttachmentsPreview } from '@/components/attachments-preview';
import { MediaToolsMenu } from '@/components/media-tools-menu';
import { ModelMenu, ModelOptions } from '@/components/model-menu';
import { PromptPicker } from '@/components/prompt-picker';

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
  onSubmit: (attachments?: Attachment[]) => void;
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

  const { chatModels, sttModels, defaults } = useSystemSettings();
  const noModels = !chatModels || chatModels.length === 0;

  const { preferences } = usePreferences();

  // Attachments: images need a vision-capable chat model; audio needs an STT
  // model the server can actually resolve (user selection or system default) —
  // otherwise the upload would be accepted but never transcribable.
  const canAttachImages = !!modelOptions.supportsVision;
  const sttModelId = preferences.sttModelId || defaults.sttModelId || '';
  const canAttachAudio =
    !!sttModels?.length && sttModels.some(m => m.modelId === sttModelId);
  const showAttachments = canAttachImages || canAttachAudio;
  const attachmentAccept = [
    canAttachImages && '.jpg,.jpeg,.png,.gif,.webp',
    canAttachAudio && '.mp3,.wav,.m4a,.ogg,.flac'
  ]
    .filter(Boolean)
    .join(',');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(attachments);
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
            placeholder="Send a message."
            className="flex-1 resize-none bg-transparent p-1 focus-within:outline-hidden"
            rows={1}
            minRows={1}
            maxRows={8}
            disabled={
              noModels || status === 'submitted' || status === 'streaming'
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
          {/* Model Menu with integrated Think button + media model picker */}
          <div className="flex items-center space-x-2">
            <ModelMenu
              models={chatModels}
              status={status}
              modelId={modelId}
              onModelChange={onModelChange}
              onOptionsChange={handleOptionsChange}
            />
            <MediaToolsMenu status={status} />
          </div>
          <div className="flex items-center space-x-2">
            <PromptPicker
              currentValue={input}
              onInsert={setInput}
              disabled={
                noModels || status === 'submitted' || status === 'streaming'
              }
            />
            {showAttachments && (
              <AttachmentsButton
                disabled={status === 'submitted' || status === 'streaming'}
                accept={attachmentAccept}
                uploadQueue={uploadQueue}
                setUploadQueue={setUploadQueue}
                attachments={attachments}
                setAttachments={setAttachments}
              />
            )}
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
                  noModels ||
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
