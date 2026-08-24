'use client';

import { useCallback } from 'react';
import { usePreferences } from '@/contexts/preferences-context';
import { useSystemSettings } from '@/contexts/system-settings-context';
import { UseChatHelpers } from '@ai-sdk/react';
import { X } from 'lucide-react';

import { ChatMessage, MediaKind } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { ModelMenu, ModelOptions } from '@/components/model-menu';

interface MediaOptionsBarProps extends Pick<
  UseChatHelpers<ChatMessage>,
  'status'
> {
  kind: MediaKind;
  onDismiss: () => void;
}

/**
 * The model and options for whichever kind was picked from the `+` menu.
 *
 * They used to live in a settings panel of their own, which meant every media
 * model was on screen at once whether or not the message had anything to do
 * with it. Here only the picked kind is shown, next to the chat model — the
 * selection stays in preferences either way, so dismissing this bar hides the
 * controls without discarding what was chosen.
 */
export function MediaOptionsBar({
  kind,
  status,
  onDismiss
}: MediaOptionsBarProps) {
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

  const menu = (() => {
    switch (kind) {
      case 'image-edit': {
        // The same image model preference, narrowed to the models that can
        // edit — a selection that cannot leaves the server with no edit_image
        // tool to register.
        const editModels = imageModels?.filter(model => model.supportsEdit);
        return editModels?.length ? (
          <ModelMenu
            capability="image"
            models={editModels}
            status={status}
            modelId={preferences.imageModelId}
            size={preferences.imageSize}
            aspectRatio={preferences.imageAspectRatio}
            onModelChange={modelId => setPreference('imageModelId', modelId)}
            onOptionsChange={handleImageOptionsChange}
          />
        ) : null;
      }
      case 'image':
        return imageModels?.length ? (
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
        ) : null;
      case 'video':
        return videoModels?.length ? (
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
        ) : null;
      case 'audio':
        return ttsModels?.length ? (
          <ModelMenu
            capability="audio"
            models={ttsModels}
            status={status}
            modelId={preferences.audioModelId}
            voice={preferences.audioVoice}
            onModelChange={modelId => setPreference('audioModelId', modelId)}
            onOptionsChange={handleAudioOptionsChange}
          />
        ) : null;
      case 'stt':
        return sttModels?.length ? (
          <ModelMenu
            capability="audio"
            models={sttModels}
            status={status}
            modelId={preferences.sttModelId}
            onModelChange={modelId => setPreference('sttModelId', modelId)}
          />
        ) : null;
    }
  })();

  if (!menu) return null;

  return (
    <>
      {menu}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 rounded-full text-muted-foreground shadow-none"
            onClick={onDismiss}
          >
            <X className="size-3.5" />
            <span className="sr-only">Hide these options</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Hide these options</TooltipContent>
      </Tooltip>
    </>
  );
}
