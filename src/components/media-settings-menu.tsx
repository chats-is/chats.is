import { useEffect, useState } from 'react';
import { usePreferences } from '@/contexts/preferences-context';
import { useSystemSettings } from '@/contexts/system-settings-context';
import { type UseChatHelpers } from '@ai-sdk/react';
import {
  AudioLines,
  Captions,
  Clapperboard,
  Image as ImageIcon,
  ImagePlay,
  Pencil,
  Scissors,
  Settings2
} from 'lucide-react';

import { type ChatMessage, type Model } from '@/types';
import {
  allowedValues,
  chooseValue,
  defaultValue,
  MediaOptionLabels,
  optionLabel,
  type MediaOptionKey
} from '@/lib/media-settings';
import { modelMatchesId } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

export interface MediaSettingsMenuProps
  extends Pick<UseChatHelpers<ChatMessage>, 'status'> {}

type OptionBinding = {
  key: MediaOptionKey;
  value: string | undefined;
  onChange: (value: string) => void;
};

/**
 * One kind of media — which model makes it, and how.
 *
 * A row rather than a panel: the name of the chosen model sits on the right,
 * the way a setting shows its current value, and the choices open beside it.
 * Seven of these stacked as panels outgrew the window; as rows they do not,
 * and each list is only as long as its own choices.
 */
function MediaKind({
  icon,
  label,
  models,
  modelId,
  onModelChange,
  options = [],
  disabled
}: {
  icon: React.ReactNode;
  label: string;
  models: Array<Model>;
  modelId: string | undefined;
  onModelChange: (modelId: string) => void;
  options?: Array<OptionBinding>;
  disabled: boolean;
}) {
  // Falling back to the first model matches what generation does with an unset
  // preference, so the row names the model that would actually run.
  const selected =
    models.find(model => modelMatchesId(model, modelId)) ?? models[0];
  const uiOptions = selected?.uiOptions;

  const rows = options
    .map(option => ({ ...option, allowed: allowedValues(uiOptions, option.key) }))
    .filter(option => option.allowed.length > 0);

  // A model swap can strip an option of the value it was holding — one model's
  // "4K" is another's nothing at all. Settle each back onto something this
  // model accepts, or the request would carry a value the provider rejects.
  useEffect(() => {
    for (const row of rows) {
      const next = chooseValue(
        row.allowed,
        row.value,
        defaultValue(uiOptions, row.key)
      );
      if (next && next !== row.value) row.onChange(next);
    }
  });

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled}>
        {icon}
        <span className="whitespace-nowrap">{label}</span>
        {/* The name gives way first: which kind of media this row sets is the
            part that has to stay readable. */}
        <span className="ml-auto min-w-0 truncate pl-3 text-xs text-muted-foreground">
          {selected?.name}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto">
        <DropdownMenuRadioGroup
          value={selected?.modelId ?? ''}
          onValueChange={onModelChange}
        >
          {models.map(model => (
            <DropdownMenuRadioItem key={model.modelId} value={model.modelId}>
              {model.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {rows.length > 0 && <DropdownMenuSeparator />}
        {rows.map(row => (
          <DropdownMenuSub key={row.key}>
            <DropdownMenuSubTrigger>
              <span className="whitespace-nowrap">
                {MediaOptionLabels[row.key]}
              </span>
              <span className="ml-auto min-w-0 truncate pl-3 text-xs text-muted-foreground">
                {row.value ? optionLabel(row.key, row.value) : null}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto">
              <DropdownMenuRadioGroup
                value={row.value ?? ''}
                onValueChange={row.onChange}
              >
                {row.allowed.map(value => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {optionLabel(row.key, value)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * Which model generates each kind of media, and with what options.
 *
 * Configured once rather than chosen per message: the chat model picks the
 * tool from what was asked, so nothing here decides whether an image gets
 * made — only what makes it. That is why these live behind a settings control
 * next to the model picker instead of inside the `+`, which is for what the
 * user adds to the message by hand. Icon-only, like the `+` beside it: the
 * toolbar sits under the text the user is writing and should not compete with
 * it for the eye.
 *
 * Selections persist as preferences and ride along in the chat request body as
 * `mediaOptions`; an unset one falls back to the admin's default.
 */
export function MediaSettingsMenu({ status }: MediaSettingsMenuProps) {
  // Prevent hydration mismatch with the Radix menu.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { imageModels, videoModels, ttsModels, sttModels } =
    useSystemSettings();
  const { preferences, setPreference } = usePreferences();

  const hasImageModels = !!imageModels?.length;
  // Editing is a per-model capability, and few models have it — so which model
  // edits is its own choice rather than a consequence of the generator.
  const editModels =
    imageModels?.filter(model => model.supportsImageEdit) ?? [];
  const hasVideoModels = !!videoModels?.length;
  // Taking an image as the opening frame is a per-model capability too.
  const animateModels =
    videoModels?.filter(model => model.supportsImageToVideo) ?? [];
  // Editing a video is separate again — a model that animates an image cannot
  // necessarily change one that already exists.
  const videoEditModels =
    videoModels?.filter(model => model.supportsVideoEdit) ?? [];
  const hasTtsModels = !!ttsModels?.length;
  const hasSttModels = !!sttModels?.length;

  if (!hasImageModels && !hasVideoModels && !hasTtsModels && !hasSttModels) {
    return null;
  }

  if (!mounted) {
    return <Skeleton className="size-9 rounded-full" />;
  }

  const busy = status === 'submitted' || status === 'streaming';

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={busy}
              className="size-9 rounded-full text-muted-foreground shadow-none"
            >
              <Settings2 className="size-4" />
              <span className="sr-only">Media generation settings</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Media generation settings</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-64">
        {hasImageModels && (
          <MediaKind
            icon={<ImageIcon />}
            label="Image"
            models={imageModels}
            modelId={preferences.imageModelId}
            onModelChange={modelId => setPreference('imageModelId', modelId)}
            disabled={busy}
            options={[
              {
                key: 'size',
                value: preferences.imageSize,
                onChange: value => setPreference('imageSize', value)
              },
              {
                key: 'aspectRatio',
                value: preferences.imageAspectRatio,
                onChange: value => setPreference('imageAspectRatio', value)
              }
            ]}
          />
        )}
        {editModels.length > 0 && (
          <MediaKind
            icon={<Pencil />}
            label="Image editing"
            models={editModels}
            modelId={preferences.imageEditModelId}
            onModelChange={modelId =>
              setPreference('imageEditModelId', modelId)
            }
            disabled={busy}
          />
        )}
        {hasVideoModels && (
          <MediaKind
            icon={<Clapperboard />}
            label="Video"
            models={videoModels}
            modelId={preferences.videoModelId}
            onModelChange={modelId => setPreference('videoModelId', modelId)}
            disabled={busy}
            options={[
              {
                key: 'aspectRatio',
                value: preferences.videoAspectRatio,
                onChange: value => setPreference('videoAspectRatio', value)
              },
              {
                key: 'resolution',
                value: preferences.videoResolution,
                onChange: value => setPreference('videoResolution', value)
              },
              {
                key: 'duration',
                value:
                  preferences.videoDuration === undefined
                    ? undefined
                    : String(preferences.videoDuration),
                onChange: value => setPreference('videoDuration', Number(value))
              }
            ]}
          />
        )}
        {animateModels.length > 0 && (
          // Model only: the options belong to the Video row above. Two rows
          // writing one set of preferences would let picking an animator
          // rewrite the generator's aspect ratio — and, when the two models
          // allow different values, leave the pair rewriting it past each
          // other for as long as this menu is open.
          <MediaKind
            icon={<ImagePlay />}
            label="Video from image"
            models={animateModels}
            modelId={preferences.videoImageModelId}
            onModelChange={modelId =>
              setPreference('videoImageModelId', modelId)
            }
            disabled={busy}
          />
        )}
        {videoEditModels.length > 0 && (
          <MediaKind
            icon={<Scissors />}
            label="Video editing"
            models={videoEditModels}
            modelId={preferences.videoEditModelId}
            onModelChange={modelId =>
              setPreference('videoEditModelId', modelId)
            }
            disabled={busy}
          />
        )}
        {hasTtsModels && (
          <MediaKind
            icon={<AudioLines />}
            label="Text → Speech"
            models={ttsModels}
            modelId={preferences.audioModelId}
            onModelChange={modelId => setPreference('audioModelId', modelId)}
            disabled={busy}
            options={[
              {
                key: 'voice',
                value: preferences.audioVoice,
                onChange: value => setPreference('audioVoice', value)
              }
            ]}
          />
        )}
        {hasSttModels && (
          <MediaKind
            icon={<Captions />}
            label="Speech → Text"
            models={sttModels}
            modelId={preferences.sttModelId}
            onModelChange={modelId => setPreference('sttModelId', modelId)}
            disabled={busy}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
