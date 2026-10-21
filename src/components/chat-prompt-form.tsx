import { useState } from 'react';
import { usePreferences } from '@/contexts/preferences-context';
import { useSystemSettings } from '@/contexts/system-settings-context';
import { type UseChatHelpers } from '@ai-sdk/react';
import { AlertTriangle, ArrowUp, Paperclip, Square } from 'lucide-react';
import Textarea from 'react-textarea-autosize';

import { type Attachment, type ChatMessage } from '@/types';
import { modelMatchesId } from '@/lib/utils';
import { canSearchWeb } from '@/lib/web-search';
import { useAttachmentUpload } from '@/hooks/use-attachment-upload';
import { useEnterSubmit } from '@/hooks/use-enter-submit';
import { useFileDrop } from '@/hooks/use-file-drop';
import { Button } from '@/components/ui/button';
import { AddFilesMenu } from '@/components/add-files-menu';
import { AttachmentsPreview } from '@/components/attachments-preview';
import { MediaSettingsMenu } from '@/components/media-settings-menu';
import { ModelMenu, type ModelOptions } from '@/components/model-menu';
import { UsageLimitAlert } from '@/components/usage-limit-alert';

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
}

export function ChatPromptForm({
  modelId,
  status,
  stop,
  input,
  setInput,
  onInputChange,
  onSubmit,
  onModelChange
}: ChatPromptFormProps) {
  const { formRef, onKeyDown } = useEnterSubmit();
  const [modelOptions, setModelOptions] = useState<ModelOptions>({});

  const { chatModels, imageModels, videoModels, sttModels, webSearch } =
    useSystemSettings();
  const { preferences } = usePreferences();

  // Two distinct dead ends, both of which make a submission fail:
  //   - no chat model is configured at all;
  //   - one exists but none is selected. The page settles on a model on
  //     offer whenever there is one, so this is the guard should it not.
  //     Either way the request would reach /api/chat with an empty or unknown
  //     modelId and come back as an opaque 400/403. Alias-aware, since that
  //     is how the server resolves a modelId.
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

  // Files come into the message three ways — the `+` menu, a drop anywhere on
  // the page, a paste into the input — all on the same terms.
  const busy = status === 'submitted' || status === 'streaming';
  const files = useAttachmentUpload({
    supportsVision: !!modelOptions.supportsVision,
    mediaGeneration: preferences.mediaGeneration,
    imageModels,
    videoModels,
    sttModels
  });
  const {
    canAttachImages,
    canAttachAudio,
    canAttachVideo,
    attachments,
    uploading,
    addFiles,
    refuseWhenFull
  } = files;
  const dropping = useFileDrop(files => void addFiles(files), !busy);

  // Whether this model can search at all — the server's own rule, so the
  // switch is offered exactly when ticking it would do something.
  const selectedModel = chatModels?.find(model =>
    modelMatchesId(model, modelId)
  );
  const canSearch =
    !!selectedModel &&
    canSearchWeb({
      ...webSearch,
      model: {
        modelId: selectedModel.modelId,
        supportsWebSearch: selectedModel.supportsWebSearch,
        providerTypes: (selectedModel.providers ?? [])
          .filter(binding => binding.isEnabled && binding.provider?.isEnabled)
          .map(binding => binding.provider!.type)
      }
    });

  // An attachment taken under other settings — another model, the media
  // tools on — still goes with the message. For each kind nothing can now use,
  // that is said beside it, in the strip under the attachments.
  const attached = (prefix: string) =>
    attachments.some(attachment => attachment.contentType?.startsWith(prefix));
  const unusable = [
    !canAttachImages &&
      attached('image/') &&
      'The selected model can’t see images, and no tool can use them.',
    !canAttachAudio && attached('audio/') && 'No tool can use the audio.',
    !canAttachVideo && attached('video/') && 'No tool can use the video.'
  ].filter((note): note is string => !!note);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Clear only once the message is actually on its way — onSubmit refuses
    // when no model resolves, and wiping the draft anyway would throw away
    // what the user typed along with any uploaded attachments.
    if (!onSubmit(attachments)) return;
    setInput('');
    files.clear();
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="w-full">
      {/* Over the whole page, since a drop is taken anywhere on it; it lets
          the drag through to the window, which is what takes the files. */}
      {dropping && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Paperclip className="size-8" />
            <span className="text-sm">
              Drop files to add them to your message
            </span>
          </div>
        </div>
      )}
      {/* Whatever is attached is shown, whatever the model now selected
          takes: an attachment still goes with the message, and one out of
          sight could be neither seen nor removed. */}
      <AttachmentsPreview
        disabled={status === 'submitted' || status === 'streaming'}
        {...files.preview}
        // Room under the thumbnails for the notice that tucks over its edge.
        className={unusable.length ? 'pb-6' : undefined}
      />
      {/* Under the attachments it is about, in a warning's own colours, and
          stacked the way they are: its rounded top laid over their lower edge,
          as they sit under the composer's. */}
      {unusable.length > 0 && (
        <div className="mx-3 -mt-3 flex items-center gap-2 rounded-t-xl border border-b-0 border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-md dark:border-amber-900 dark:bg-amber-950 dark:text-amber-50">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="flex-1">{unusable.join(' ')}</span>
        </div>
      )}
      <UsageLimitAlert />
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
            // A file on the clipboard — a screenshot, a file copied in the
            // file manager — is attached. Rich text copied from a document or
            // a page often carries a picture of itself along with it; that is
            // pasted as the text it is.
            onPaste={e => {
              const files = Array.from(e.clipboardData.files);
              if (!files.length || e.clipboardData.types.includes('text/html'))
                return;
              e.preventDefault();
              void addFiles(files);
            }}
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
            <AddFilesMenu
              disabled={busy}
              canAttachImages={canAttachImages}
              canAttachAudio={canAttachAudio}
              canAttachVideo={canAttachVideo}
              canSearchWeb={canSearch}
              addFiles={addFiles}
              refuseWhenFull={refuseWhenFull}
            />
            <ModelMenu
              models={chatModels}
              status={status}
              modelId={modelId}
              onModelChange={onModelChange}
              onOptionsChange={setModelOptions}
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
                  uploading
                }
              >
                <ArrowUp className="size-4" />
                <span className="sr-only">Send message</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
