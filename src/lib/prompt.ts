import { type Preferences } from '@/contexts/preferences-context';

import { type Model, type ModelCapability, type SystemSettings } from '@/types';
import { type MediaToolsOptions } from '@/types/chat-tools';
import { AUTO_OPTION } from '@/lib/constant';
import { type MediaOptionKey } from '@/lib/media-settings';
import { isSttModel, isTtsModel } from '@/lib/utils';

type MediaKind = keyof MediaToolsOptions;

/** Which entries of the media generation settings each type is tried on,
 *  without a reference and with one. A video's reference may be an image to
 *  animate or a video to edit, so it has both; a chat prompt has none. */
const PROMPT_MEDIA_KINDS: Record<
  ModelCapability,
  Record<'plain' | 'reference', MediaKind[]>
> = {
  chat: { plain: [], reference: [] },
  image: { plain: ['image'], reference: ['imageEdit'] },
  video: { plain: ['video'], reference: ['videoImage', 'videoEdit'] },
  audio: { plain: ['audio'], reference: ['stt'] }
};

/** Where the user's own choice of each entry's model is kept. */
const MEDIA_KIND_PREFERENCES = {
  image: 'imageModelId',
  imageEdit: 'imageEditModelId',
  video: 'videoModelId',
  videoImage: 'videoImageModelId',
  videoEdit: 'videoEditModelId',
  audio: 'audioModelId',
  stt: 'sttModelId'
} as const satisfies Record<MediaKind, keyof Preferences>;

type MediaKindOption = {
  key: MediaOptionKey;
  preference: keyof Preferences;
};

const IMAGE_OPTIONS: MediaKindOption[] = [
  { key: 'aspectRatio', preference: 'imageAspectRatio' },
  { key: 'size', preference: 'imageSize' },
  { key: 'resolution', preference: 'imageResolution' }
];

const VIDEO_OPTIONS: MediaKindOption[] = [
  { key: 'aspectRatio', preference: 'videoAspectRatio' },
  { key: 'size', preference: 'videoSize' },
  { key: 'resolution', preference: 'videoResolution' },
  { key: 'duration', preference: 'videoDuration' }
];

/** The options what each entry makes is made with, and where the user's own
 *  are kept — as the chat's tools read them: an edit is drawn in the Image
 *  settings and an animated image in the Video ones; an edited video comes
 *  out as its source is, and a transcript is no media at all. */
const MEDIA_KIND_OPTIONS: Record<MediaKind, MediaKindOption[]> = {
  image: IMAGE_OPTIONS,
  imageEdit: IMAGE_OPTIONS,
  video: VIDEO_OPTIONS,
  videoImage: VIDEO_OPTIONS,
  videoEdit: [],
  audio: [{ key: 'voice', preference: 'audioVoice' }],
  stt: []
};

/** The entries of the media generation settings a prompt is tried on, by
 *  its type and its reference. */
export function promptMediaKinds(
  type: ModelCapability,
  needsReference: boolean
): MediaKind[] {
  return PROMPT_MEDIA_KINDS[type][needsReference ? 'reference' : 'plain'];
}

/** Whether a model can be an entry's: the line the media generation
 *  settings draw — editing an image, animating one and editing a video are
 *  each a capability of their own. */
export function fitsMediaKind(
  kind: MediaKind,
  model: Pick<
    Model,
    | 'capability'
    | 'supportsImageEdit'
    | 'supportsImageToVideo'
    | 'supportsVideoEdit'
    | 'supportsTranscription'
  >
): boolean {
  switch (kind) {
    case 'image':
      return model.capability === 'image';
    case 'imageEdit':
      return model.capability === 'image' && !!model.supportsImageEdit;
    case 'video':
      return model.capability === 'video';
    case 'videoImage':
      return model.capability === 'video' && !!model.supportsImageToVideo;
    case 'videoEdit':
      return model.capability === 'video' && !!model.supportsVideoEdit;
    case 'audio':
      return isTtsModel(model);
    case 'stt':
      return isSttModel(model);
  }
}

type ModelLists = Pick<
  SystemSettings,
  'chatModels' | 'imageModels' | 'videoModels' | 'ttsModels' | 'sttModels'
>;

/** The models on offer an entry can use. */
export function mediaKindModels(lists: ModelLists, kind: MediaKind): Model[] {
  return [
    ...lists.imageModels,
    ...lists.videoModels,
    ...lists.ttsModels,
    ...lists.sttModels
  ].filter(model => fitsMediaKind(kind, model));
}

/** The one of a prompt's entries that what is attached makes it, as the chat
 *  decides by the same: a video is edited, an image animated. Null while a
 *  video prompt has neither. */
export function attachedMediaKind(
  kinds: MediaKind[],
  attachments: Array<{ contentType?: string }>
): MediaKind | null {
  if (kinds.length < 2) return kinds[0] ?? null;
  const attached = (prefix: string) =>
    attachments.some(({ contentType }) => contentType?.startsWith(prefix));
  if (attached('video/') && kinds.includes('videoEdit')) return 'videoEdit';
  if (attached('image/') && kinds.includes('videoImage')) return 'videoImage';
  return null;
}

/** The user's own model for an entry, as their settings hold it. */
export function preferredModelId(
  preferences: Preferences,
  kind: MediaKind
): string {
  return preferences[MEDIA_KIND_PREFERENCES[kind]];
}

/** An entry's options, each with the user's own value as their settings hold
 *  it, as a string, the way a menu compares it. */
export function mediaKindOptions(
  preferences: Preferences,
  kind: MediaKind
): Array<{ key: MediaOptionKey; value: string | undefined }> {
  return MEDIA_KIND_OPTIONS[kind].map(({ key, preference }) => {
    const held = preferences[preference];
    return { key, value: held === undefined ? undefined : String(held) };
  });
}

/**
 * What was chosen when a prompt was tried, made the user's own, as a choice
 * in the composer's model menu and its media generation settings is: the
 * chat model, and for a media prompt the entry's model, its options — a
 * duration as its number of seconds — and media generation on.
 */
export function choosePromptSettings(
  setPreference: <TKey extends keyof Preferences>(
    key: TKey,
    value: Preferences[TKey]
  ) => void,
  chatModelId: string,
  media: {
    kind: MediaKind;
    modelId: string;
    options: Partial<Record<MediaOptionKey, string>>;
  } | null
) {
  setPreference('chatModelId', chatModelId);
  if (!media) return;
  setPreference(MEDIA_KIND_PREFERENCES[media.kind], media.modelId);
  for (const { key, preference } of MEDIA_KIND_OPTIONS[media.kind]) {
    const value = media.options[key];
    if (value === undefined) continue;
    setPreference(
      preference,
      (key === 'duration' && value !== AUTO_OPTION
        ? Number(value)
        : value) as Preferences[typeof preference]
    );
  }
  setPreference('mediaGeneration', true);
}

/** A model on offer, of any kind, by its id — a prompt's preset. */
export function findModel(
  lists: ModelLists,
  modelId: string | null | undefined
): Model | undefined {
  if (!modelId) return undefined;
  return [
    ...lists.chatModels,
    ...lists.imageModels,
    ...lists.videoModels,
    ...lists.ttsModels,
    ...lists.sttModels
  ].find(model => model.modelId === modelId);
}
