import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from '@tanstack/react-router';
import { usePreferences } from '@/contexts/preferences-context';
import { useSystemSettings } from '@/contexts/system-settings-context';
import { RotateCcw } from 'lucide-react';

import { type ModelCapability } from '@/types';
import { MEDIA_KIND_LABELS } from '@/lib/constant';
import {
  allowedValues,
  chooseValue,
  defaultValue,
  modelVocabulary,
  type MediaOptionKey
} from '@/lib/media-settings';
import { setPendingPrompt, type PendingPrompt } from '@/lib/pending-prompt';
import {
  attachedMediaKind,
  choosePromptSettings,
  mediaKindModels,
  mediaKindOptions,
  preferredModelId,
  promptMediaKinds
} from '@/lib/prompt';
import { modelMatchesId } from '@/lib/utils';
import { useAttachmentUpload } from '@/hooks/use-attachment-upload';
import { type listUsablePrompts } from '@/server/functions/prompt';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { acceptedFiles } from '@/components/add-files-menu';
import { AttachmentsPreview } from '@/components/attachments-preview';
import { ModelSelect } from '@/components/model-select';
import { PromptOptionChips } from '@/components/prompt-option-chips';
import { UploadButton } from '@/components/upload-button';

export type UsablePrompt = Awaited<
  ReturnType<typeof listUsablePrompts>
>[number];

/**
 * A prompt opened to be tried: a template of words, a model and options.
 * Its example beside it, its words to change for this try, the chat model it
 * is sent with, and for a media prompt the entry of the media generation
 * settings its type and reference call for — that entry's model and options,
 * as the menu offers them — and what may or must be added. Try it makes what
 * was chosen the user's own, as the composer's menus do, and sends the prompt
 * to the chat: `onTry` where it is tried from beside the composer, else a new
 * chat.
 */
export function PromptDialog({
  prompt,
  open,
  onOpenChange,
  onTry
}: {
  prompt: UsablePrompt;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTry?: (prompt: PendingPrompt) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90dvh] gap-0 overflow-hidden p-0 sm:max-w-4xl"
        // Focus goes to the prompt's words (see PromptEditor), not to the
        // first control, which would ring the model menu as though it were
        // the thing to change.
        onOpenAutoFocus={event => event.preventDefault()}
        // Described by what it holds, which is there to be changed rather
        // than read out.
        aria-describedby={undefined}
      >
        {/* Inside the content, which Radix unmounts on close: every opening
            starts from the prompt again. */}
        <PromptDialogBody
          prompt={prompt}
          onTry={onTry}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** What a prompt's reference is, by its type, as the dialog asks for it. */
const REFERENCE_COPY: Record<
  ModelCapability,
  { label: string; missing: string }
> = {
  chat: { label: 'Reference file', missing: 'Add a file to try it.' },
  image: {
    label: 'Reference image',
    missing: 'Add a reference image to try it.'
  },
  video: {
    label: 'Reference image or video',
    missing: 'Add a reference image or video to try it.'
  },
  audio: {
    label: 'Reference audio',
    missing: 'Add a reference audio file to try it.'
  }
};

/** Whether what was added holds the reference a prompt of this type needs. */
function hasReference(
  type: ModelCapability,
  added: Array<{ contentType?: string }>
): boolean {
  return added.some(({ contentType = '' }) => {
    switch (type) {
      case 'chat':
        return true;
      case 'image':
        return contentType.startsWith('image/');
      case 'video':
        return (
          contentType.startsWith('image/') || contentType.startsWith('video/')
        );
      case 'audio':
        return contentType.startsWith('audio/');
    }
  });
}

function PromptDialogBody({
  prompt,
  onTry,
  onClose
}: {
  prompt: UsablePrompt;
  onTry?: (prompt: PendingPrompt) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const settings = useSystemSettings();
  const { chatModels } = settings;
  const { preferences, setPreference } = usePreferences();
  const { type, needsReference } = prompt;

  // The words sent: the prompt's own until the reader changes them, for this
  // one try — the prompt itself stays as written.
  const [text, setText] = useState(prompt.content);

  // The chat model it is sent with, from every chat model on offer: the
  // prompt's own for a chat prompt that presets one of them, else the user's
  // own.
  const [chatModelId, setChatModelId] = useState(() =>
    type === 'chat' &&
    prompt.modelId &&
    chatModels.some(model => model.modelId === prompt.modelId)
      ? prompt.modelId
      : preferences.chatModelId
  );
  const chatModel = chatModels.find(model =>
    modelMatchesId(model, chatModelId)
  );

  // What it goes with, on the chat's own terms for this chat model — with
  // media generation on for a media prompt, as trying it turns it on.
  const files = useAttachmentUpload({
    supportsVision: !!chatModel?.supportsVision,
    mediaGeneration: type !== 'chat' || preferences.mediaGeneration,
    imageModels: settings.imageModels,
    videoModels: settings.videoModels,
    sttModels: settings.sttModels
  });

  // For a media prompt, the entry of the media generation settings it is
  // tried on. A video prompt's reference decides between animating and
  // editing, as the chat decides by what is attached; until one is added,
  // the entry of the model picked here, else of the prompt's own.
  const kinds = promptMediaKinds(type, needsReference);
  const byAttachment = attachedMediaKind(kinds, files.attachments);
  const [mediaModelId, setMediaModelId] = useState<string | null>(null);
  const offers = (kind: (typeof kinds)[number], modelId: string | null) =>
    mediaKindModels(settings, kind).some(model => model.modelId === modelId);
  const kind =
    byAttachment ??
    kinds.find(each => offers(each, mediaModelId)) ??
    kinds.find(each => offers(each, prompt.modelId)) ??
    kinds[0];
  // The model picked here, else the prompt's own, else the user's own for the
  // entry — and failing those the first, as the menu falls back.
  const models = kind ? mediaKindModels(settings, kind) : [];
  const mediaModel = kind
    ? (models.find(model => model.modelId === mediaModelId) ??
      models.find(model => model.modelId === prompt.modelId) ??
      models.find(model =>
        modelMatchesId(model, preferredModelId(preferences, kind))
      ) ??
      models[0])
    : undefined;
  // Before a video prompt's reference decides, both of its entries.
  const mediaGroups = (byAttachment ? [byAttachment] : kinds)
    .map(each => ({
      label: MEDIA_KIND_LABELS[each],
      models: mediaKindModels(settings, each)
    }))
    .filter(group => group.models.length > 0);

  // The options what is made is made with: the user's own, with what is
  // picked here over them, each offered and settled as the media generation
  // settings offer and settle it for this model.
  const [picked, setPicked] = useState<Partial<Record<MediaOptionKey, string>>>(
    {}
  );
  const vocabulary = modelVocabulary(mediaModel);
  const rows =
    kind && mediaModel
      ? mediaKindOptions(preferences, kind)
          .map(option => ({
            ...option,
            allowed: allowedValues(mediaModel.uiOptions, option.key, vocabulary)
          }))
          .filter(row => row.allowed.length > 0)
      : [];
  const values = Object.fromEntries(
    rows.map(row => [
      row.key,
      chooseValue(
        row.allowed,
        picked[row.key] ?? row.value,
        defaultValue(mediaModel?.uiOptions, row.key)
      )
    ])
  );

  const missing = needsReference && !hasReference(type, files.attachments);
  const reference = needsReference ? REFERENCE_COPY[type] : null;

  // What was chosen here becomes the user's own, as a choice in the
  // composer's menus does, and the prompt goes to the chat — which is the
  // whole of trying it.
  const tryIt = () => {
    if (!chatModel) return;
    choosePromptSettings(
      setPreference,
      chatModel.modelId,
      kind && mediaModel
        ? { kind, modelId: mediaModel.modelId, options: values }
        : null
    );
    const tried = { content: text.trim(), attachments: files.attachments };
    onClose();
    if (onTry) {
      onTry(tried);
      return;
    }
    setPendingPrompt(tried);
    // invalidate() forces a fresh `/` render (new chat id → remount) so the
    // hand-off is read even when `/` is served from the router cache.
    void router.navigate({ to: '/' });
    void router.invalidate();
  };

  const editor = (
    <PromptEditor
      value={text}
      original={prompt.content}
      onChange={setText}
      fill={!prompt.image}
    />
  );

  return (
    <div className="grid max-h-[90dvh] min-h-0 md:grid-cols-2">
      {prompt.image ? (
        // At its own size in the middle of the panel, and never past it: a
        // small example is not blown up, a large one is shown whole. The
        // panel is square beside the settings, the shape most examples are,
        // and it is what sets the dialog's height.
        <div className="flex max-h-[36dvh] min-h-0 items-center justify-center overflow-hidden bg-muted md:aspect-square md:max-h-none">
          <img
            src={prompt.image}
            alt=""
            className="max-h-[36dvh] max-w-full object-contain md:max-h-full"
          />
        </div>
      ) : (
        // A prompt that is only words is read and changed here, whole, from
        // the top — and not repeated beside it. Scrolled within the panel
        // rather than sizing it, so a long one does not stretch the dialog;
        // square, as an example's panel is, so every dialog is one size.
        <div className="relative h-[36dvh] bg-muted md:aspect-square md:h-auto">
          {editor}
        </div>
      )}

      {/* As tall as the square beside it and no taller — no height of its
          own on a wide screen, and the row's at least — so what does not fit
          scrolls here rather than stretching the dialog. */}
      <div className="flex min-h-0 flex-col md:h-0 md:min-h-full">
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          <div className="space-y-3">
            {/* Clear of the close button in the corner. */}
            <DialogTitle className="pr-6 text-lg">{prompt.name}</DialogTitle>
            {prompt.image && editor}
          </div>

          <Section label="Model">
            <ModelSelect
              groups={[{ label: 'Chat', models: chatModels }]}
              value={chatModel?.modelId ?? null}
              onValueChange={modelId => modelId && setChatModelId(modelId)}
              recommendedId={type === 'chat' ? prompt.modelId : null}
              className="w-full"
            />
          </Section>

          {kind && mediaGroups.length > 0 && (
            <Section label={MEDIA_KIND_LABELS[kind]}>
              <ModelSelect
                // Its items change once a reference decides the entry.
                key={mediaGroups.map(group => group.label).join()}
                groups={mediaGroups}
                value={mediaModel?.modelId ?? null}
                onValueChange={setMediaModelId}
                recommendedId={prompt.modelId}
                className="w-full"
              />
            </Section>
          )}

          {rows.length > 0 && (
            <PromptOptionChips
              rows={rows}
              values={values}
              onChange={(key, option) =>
                setPicked(current => ({ ...current, [key]: option }))
              }
            />
          )}

          <Section label={reference?.label ?? 'Attachments'}>
            <div className="flex items-start gap-2">
              <UploadButton
                accept={acceptedFiles(files)}
                multiple
                onFiles={chosen => void files.addFiles(chosen)}
                className="mt-1.5"
              />
              <AttachmentsPreview
                {...files.preview}
                // Room inside its scroll for the remove buttons that stand out
                // past each tile's corner.
                className="m-0 min-w-0 flex-1 rounded-none border-0 bg-transparent py-1.5 pr-1.5 pl-1 shadow-none"
              />
            </div>
          </Section>
        </div>

        <div className="flex items-center gap-3 border-t px-6 py-4">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {missing ? reference?.missing : null}
          </p>
          <Button
            className="shrink-0 rounded-full px-5"
            disabled={missing || files.uploading || !text.trim() || !chatModel}
            onClick={tryIt}
          >
            Try it
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The prompt's words, to change before trying it: the panel's whole height
 * for a prompt that is only words, a box that grows with them beside an
 * example. Opened with the caret at the end, for what the reader adds — on a
 * device with a pointer; on a touch screen that would raise the keyboard over
 * the dialog before anything was read. Reset brings back the prompt as
 * written.
 */
function PromptEditor({
  value,
  original,
  onChange,
  fill
}: {
  value: string;
  original: string;
  onChange: (value: string) => void;
  fill: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !window.matchMedia('(pointer: fine)').matches) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    // Read from the top, whatever the caret did to the scroll.
    el.scrollTop = 0;
  }, []);

  const reset = value !== original && (
    <button
      type="button"
      onClick={() => onChange(original)}
      className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground shadow-xs hover:text-foreground"
    >
      <RotateCcw className="size-3" />
      Reset
    </button>
  );

  if (fill) {
    return (
      <>
        <textarea
          ref={ref}
          aria-label="Prompt"
          value={value}
          onChange={event => onChange(event.target.value)}
          className="absolute inset-0 size-full resize-none bg-transparent p-6 pr-12 text-sm text-foreground/80 outline-none md:pr-6"
        />
        {reset && <div className="absolute right-3 bottom-3">{reset}</div>}
      </>
    );
  }

  return (
    <div className="space-y-1.5">
      <textarea
        ref={ref}
        aria-label="Prompt"
        value={value}
        onChange={event => onChange(event.target.value)}
        className="field-sizing-content max-h-60 min-h-24 w-full resize-none rounded-xl border bg-transparent px-3 py-2 text-sm text-foreground/80 outline-none focus-visible:border-ring"
      />
      {reset && <div className="flex justify-end">{reset}</div>}
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
