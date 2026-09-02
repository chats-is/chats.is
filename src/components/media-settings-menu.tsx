import { useCallback, useEffect, useState } from 'react';
import { usePreferences } from '@/contexts/preferences-context';
import { useSystemSettings } from '@/contexts/system-settings-context';
import { UseChatHelpers } from '@ai-sdk/react';
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

import { ChatMessage } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { ModelMenu, ModelOptions } from '@/components/model-menu';

export interface MediaSettingsMenuProps extends Pick<
  UseChatHelpers<ChatMessage>,
  'status'
> {}

function SectionLabel({
  icon,
  children
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      {icon}
      {children}
    </div>
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
  // Prevent hydration mismatch with the Radix popover.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { imageModels, videoModels, ttsModels, sttModels } =
    useSystemSettings();
  const { preferences, setPreference } = usePreferences();

  const handleImageOptionsChange = useCallback(
    (options: ModelOptions) => {
      if (options.size !== undefined) {
        setPreference('imageSize', options.size);
      }
      if (options.aspectRatio !== undefined) {
        setPreference('imageAspectRatio', options.aspectRatio);
      }
    },
    [setPreference]
  );

  const handleVideoOptionsChange = useCallback(
    (options: ModelOptions) => {
      if (options.aspectRatio !== undefined) {
        setPreference('videoAspectRatio', options.aspectRatio);
      }
      if (options.resolution !== undefined) {
        setPreference('videoResolution', options.resolution);
      }
      if (options.duration !== undefined) {
        setPreference('videoDuration', options.duration);
      }
    },
    [setPreference]
  );

  const handleAudioOptionsChange = useCallback(
    (options: ModelOptions) => {
      if (options.voice !== undefined) {
        setPreference('audioVoice', options.voice);
      }
    },
    [setPreference]
  );

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

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={status === 'submitted' || status === 'streaming'}
              className="size-9 rounded-full text-muted-foreground shadow-none"
            >
              <Settings2 className="size-4" />
              <span className="sr-only">Media generation settings</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Media generation settings</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        className="w-auto max-w-[calc(100vw-2rem)] space-y-4 p-4"
      >
        {hasImageModels && (
          <div className="space-y-2">
            <SectionLabel icon={<ImageIcon className="size-3.5" />}>
              Image
            </SectionLabel>
            <ModelMenu
              capability="image"
              models={imageModels}
              status={status}
              modelId={preferences.imageModelId}
              size={preferences.imageSize}
              aspectRatio={preferences.imageAspectRatio}
              onModelChange={modelId => setPreference('imageModelId', modelId)}
              onOptionsChange={handleImageOptionsChange}
            />
          </div>
        )}
        {editModels.length > 0 && (
          <div className="space-y-2">
            <SectionLabel icon={<Pencil className="size-3.5" />}>
              Image editing
            </SectionLabel>
            <ModelMenu
              capability="image"
              models={editModels}
              status={status}
              modelId={preferences.imageEditModelId}
              onModelChange={modelId =>
                setPreference('imageEditModelId', modelId)
              }
            />
          </div>
        )}
        {hasVideoModels && (
          <div className="space-y-2">
            <SectionLabel icon={<Clapperboard className="size-3.5" />}>
              Video
            </SectionLabel>
            <ModelMenu
              capability="video"
              models={videoModels}
              status={status}
              modelId={preferences.videoModelId}
              aspectRatio={preferences.videoAspectRatio}
              resolution={preferences.videoResolution}
              duration={preferences.videoDuration}
              onModelChange={modelId => setPreference('videoModelId', modelId)}
              onOptionsChange={handleVideoOptionsChange}
            />
          </div>
        )}
        {animateModels.length > 0 && (
          <div className="space-y-2">
            <SectionLabel icon={<ImagePlay className="size-3.5" />}>
              Video from image
            </SectionLabel>
            {/* Model only: the options belong to the Video section above.
                Two menus writing one set of preferences would let picking an
                animator rewrite the generator's aspect ratio — and, when the
                two models allow different values, leave the pair rewriting it
                past each other for as long as this popover is open. */}
            <ModelMenu
              capability="video"
              models={animateModels}
              status={status}
              modelId={preferences.videoImageModelId}
              onModelChange={modelId =>
                setPreference('videoImageModelId', modelId)
              }
            />
          </div>
        )}
        {videoEditModels.length > 0 && (
          <div className="space-y-2">
            <SectionLabel icon={<Scissors className="size-3.5" />}>
              Video editing
            </SectionLabel>
            <ModelMenu
              capability="video"
              models={videoEditModels}
              status={status}
              modelId={preferences.videoEditModelId}
              onModelChange={modelId =>
                setPreference('videoEditModelId', modelId)
              }
            />
          </div>
        )}
        {hasTtsModels && (
          <div className="space-y-2">
            <SectionLabel icon={<AudioLines className="size-3.5" />}>
              Text → Speech
            </SectionLabel>
            <ModelMenu
              capability="audio"
              models={ttsModels}
              status={status}
              modelId={preferences.audioModelId}
              voice={preferences.audioVoice}
              onModelChange={modelId => setPreference('audioModelId', modelId)}
              onOptionsChange={handleAudioOptionsChange}
            />
          </div>
        )}
        {hasSttModels && (
          <div className="space-y-2">
            <SectionLabel icon={<Captions className="size-3.5" />}>
              Speech → Text
            </SectionLabel>
            <ModelMenu
              capability="audio"
              models={sttModels}
              status={status}
              modelId={preferences.sttModelId}
              onModelChange={modelId => setPreference('sttModelId', modelId)}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
