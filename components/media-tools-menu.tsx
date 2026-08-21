'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePreferences } from '@/contexts/preferences-context';
import { useSystemSettings } from '@/contexts/system-settings-context';
import { UseChatHelpers } from '@ai-sdk/react';
import {
  AudioLines,
  Captions,
  Clapperboard,
  Image as ImageIcon,
  WandSparkles
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

export interface MediaToolsMenuProps extends Pick<
  UseChatHelpers<ChatMessage>,
  'status'
> {}

/**
 * Compact popover next to the chat model picker for choosing which media
 * models the chat media tools (generate_image / edit_image / generate_video /
 * text_to_speech) use, plus their generation options. Selections persist as
 * preferences and ride along in the chat request body as `mediaOptions`.
 */
export function MediaToolsMenu({ status }: MediaToolsMenuProps) {
  // Prevent hydration mismatch with Radix Popover
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
  const hasVideoModels = !!videoModels?.length;
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
              <WandSparkles className="size-4" />
              <span className="sr-only">Media generation models</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Media generation models</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        className="w-auto max-w-[calc(100vw-2rem)] space-y-4 p-4"
      >
        {hasImageModels && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ImageIcon className="size-3.5" />
              Image
            </div>
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
        {hasVideoModels && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Clapperboard className="size-3.5" />
              Video
            </div>
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
        {hasTtsModels && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <AudioLines className="size-3.5" />
              Text → Speech
            </div>
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
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Captions className="size-3.5" />
              Speech → Text
            </div>
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
