import { useEffect, useMemo, useState } from 'react';
import { usePreferences } from '@/contexts/preferences-context';
import { type UseChatHelpers } from '@ai-sdk/react';
import { Eye, Lightbulb, Pencil, Scissors } from 'lucide-react';

import { type ChatMessage, type Model, type ModelCapability } from '@/types';
import {
  AspectRatioLabels,
  ImageSizeLabels,
  VideoResolutionLabels
} from '@/lib/constant';
import { onSelect } from '@/lib/select';
import { cn, modelMatchesId } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { ModelIcon } from '@/components/model-icon';

export interface ModelMenuProps extends Pick<
  UseChatHelpers<ChatMessage>,
  'status'
> {
  /** The capability type for model selection */
  capability?: ModelCapability;
  /** Pre-filtered models to display */
  models: Model[];
  /** Current model value (controlled) */
  modelId: string;
  /** Callback when model changes */
  onModelChange: (modelId: string) => void;
  /** Callback when model options change (like reasoning, size, aspectRatio, voice) */
  onOptionsChange?: (options: ModelOptions) => void;
  /** Current size value (for image capability) */
  size?: string;
  /** Current aspect ratio value (for image & video capability) */
  aspectRatio?: string;
  /** Current resolution value (for video capability) */
  resolution?: string;
  /** Current duration value in seconds (for video capability) */
  duration?: number;
  /** Current voice value (for audio capability) */
  voice?: string;
}

export interface ModelOptions {
  isReasoning?: boolean;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  /** Size value (for image) */
  size?: string;
  /** AspectRatio value (for image & video) */
  aspectRatio?: string;
  /** Resolution value (for video) */
  resolution?: string;
  /** Duration value in seconds (for video) */
  duration?: number;
  /** Voice value (for audio) */
  voice?: string;
}

export function ModelMenu({
  status,
  capability = 'chat',
  models,
  modelId,
  onModelChange,
  onOptionsChange,
  size,
  aspectRatio,
  resolution,
  duration,
  voice
}: ModelMenuProps) {
  // Prevent hydration mismatch with Radix Select
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { preferences, setPreference } = usePreferences();

  // Track isReasoning state from preferences
  const [isReasoning, setIsReasoning] = useState(preferences.chatReasoning);

  // Find selected model from database models
  const selectedModel = useMemo(
    () => models?.find(m => modelMatchesId(m, modelId)),
    [models, modelId]
  );

  // Get available options from selected model
  const uiOptions = selectedModel?.uiOptions as Record<string, unknown> | null;
  const defaultSize = typeof uiOptions?.size === 'string' ? uiOptions.size : '';
  const availableSizes = useMemo(
    () => (uiOptions?.sizes as string[]) || [],
    [uiOptions?.sizes]
  );
  const defaultAspectRatio =
    typeof uiOptions?.aspectRatio === 'string' ? uiOptions.aspectRatio : '';
  const availableAspectRatios = useMemo(
    () => (uiOptions?.aspectRatios as string[]) || [],
    [uiOptions?.aspectRatios]
  );
  const defaultDuration = useMemo(() => {
    const value = uiOptions?.duration;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }, [uiOptions?.duration]);
  const availableDurations = useMemo(() => {
    const values = uiOptions?.durations;
    if (!Array.isArray(values)) return [];
    return values
      .map(v => (typeof v === 'number' ? v : Number(v)))
      .filter(v => Number.isFinite(v));
  }, [uiOptions?.durations]);
  const defaultResolution =
    typeof uiOptions?.resolution === 'string' ? uiOptions.resolution : '';
  const availableResolutions = useMemo(
    () => (uiOptions?.resolutions as string[]) || [],
    [uiOptions?.resolutions]
  );
  const defaultVoice =
    typeof uiOptions?.voice === 'string' ? uiOptions.voice : '';
  const availableVoices = useMemo(
    () => (uiOptions?.voices as string[]) || [],
    [uiOptions?.voices]
  );

  // Notify parent of model capabilities and auto-select options
  useEffect(() => {
    if (!selectedModel) return;

    // Notify supportsVision on mount and model change
    onOptionsChange?.({
      supportsVision: selectedModel.supportsVision ?? undefined
    });

    // Auto-select default size, fallback to the first available option.
    if (
      capability === 'image' &&
      availableSizes.length > 0 &&
      (!size || !availableSizes.includes(size))
    ) {
      const nextSize = availableSizes.includes(preferences.imageSize)
        ? preferences.imageSize
        : availableSizes.includes(defaultSize)
          ? defaultSize
          : availableSizes[0];
      if (nextSize !== size) {
        onOptionsChange?.({ size: nextSize });
      }
    }

    // Auto-select default aspectRatio, fallback to the first available option.
    if (
      (capability === 'image' || capability === 'video') &&
      availableAspectRatios.length > 0 &&
      (!aspectRatio || !availableAspectRatios.includes(aspectRatio))
    ) {
      const preferenceAspectRatio =
        capability === 'image'
          ? preferences.imageAspectRatio
          : preferences.videoAspectRatio;
      const nextAspectRatio = availableAspectRatios.includes(
        preferenceAspectRatio
      )
        ? preferenceAspectRatio
        : availableAspectRatios.includes(defaultAspectRatio)
          ? defaultAspectRatio
          : availableAspectRatios[0];
      if (nextAspectRatio !== aspectRatio) {
        onOptionsChange?.({ aspectRatio: nextAspectRatio });
      }
    }

    // Auto-select default duration, fallback to the first available option.
    if (
      capability === 'video' &&
      availableDurations.length > 0 &&
      (duration === undefined || !availableDurations.includes(duration))
    ) {
      const preferred = preferences.videoDuration;
      const nextDuration =
        preferred !== undefined && availableDurations.includes(preferred)
          ? preferred
          : defaultDuration !== undefined &&
              availableDurations.includes(defaultDuration)
            ? defaultDuration
            : availableDurations[0];
      if (nextDuration !== duration) {
        onOptionsChange?.({ duration: nextDuration });
      }
    }

    // Auto-select default resolution, fallback to the first available option.
    if (
      capability === 'video' &&
      availableResolutions.length > 0 &&
      (!resolution || !availableResolutions.includes(resolution))
    ) {
      const nextResolution = availableResolutions.includes(
        preferences.videoResolution
      )
        ? preferences.videoResolution
        : availableResolutions.includes(defaultResolution)
          ? defaultResolution
          : availableResolutions[0];
      if (nextResolution !== resolution) {
        onOptionsChange?.({ resolution: nextResolution });
      }
    }

    // Auto-select default voice, fallback to the first available option.
    if (
      capability === 'audio' &&
      availableVoices.length > 0 &&
      (!voice || !availableVoices.includes(voice))
    ) {
      const nextVoice = availableVoices.includes(preferences.audioVoice)
        ? preferences.audioVoice
        : availableVoices.includes(defaultVoice)
          ? defaultVoice
          : availableVoices[0];
      if (nextVoice !== voice) {
        onOptionsChange?.({ voice: nextVoice });
      }
    }
  }, [
    selectedModel,
    capability,
    size,
    aspectRatio,
    resolution,
    duration,
    voice,
    availableSizes,
    defaultSize,
    availableAspectRatios,
    defaultAspectRatio,
    availableDurations,
    defaultDuration,
    availableResolutions,
    defaultResolution,
    availableVoices,
    defaultVoice,
    preferences.imageSize,
    preferences.imageAspectRatio,
    preferences.videoAspectRatio,
    preferences.videoDuration,
    preferences.videoResolution,
    preferences.audioVoice,
    onOptionsChange
  ]);

  if (!mounted) {
    return (
      <div className="flex h-9 items-center rounded-full border px-3">
        <Skeleton className="mr-2 size-4 rounded-full" />
        <Skeleton className="mr-1 h-4 w-20" />
        <Skeleton className="size-4 rounded-full" />
      </div>
    );
  }

  // Grouped models by provider for display
  const groupedModels = (models ?? [])
    .filter(m => m.provider)
    .reduce(
      (acc, m) => {
        const providerKey = m.provider!.id;
        if (!acc[providerKey]) {
          acc[providerKey] = [];
        }
        acc[providerKey].push(m);
        return acc;
      },
      {} as Record<string, Model[]>
    );

  // Handler for model change
  const handleModelChange = (newModel: string) => {
    // Ignore empty values (Radix Select fires empty change during hydration)
    if (!newModel) return;

    // Notify parent (parent handles saving to preferences)
    onModelChange(newModel);

    // Find the new model and notify about its options
    const newModelData = models?.find(m => m.modelId === newModel);
    if (newModelData) {
      const supportsReasoning = newModelData.uiOptions?.reasoning;
      onOptionsChange?.({
        supportsVision: newModelData.supportsVision ?? undefined,
        supportsReasoning: supportsReasoning ?? undefined,
        isReasoning: supportsReasoning ? isReasoning : undefined
      });
    }
  };

  // Handler for reasoning toggle (only for chat capability)
  const handleReasoningToggle = () => {
    if (capability !== 'chat') return;
    const newValue = !isReasoning;
    setIsReasoning(newValue);
    setPreference('chatReasoning', newValue);
    onOptionsChange?.({
      supportsVision: selectedModel?.supportsVision ?? undefined,
      supportsReasoning: selectedModel?.uiOptions?.reasoning ?? undefined,
      isReasoning: newValue
    });
  };

  const isDisabled =
    status === 'submitted' || status === 'streaming' || !models?.length;

  return (
    <div className="flex items-center space-x-2">
      <Select
        disabled={isDisabled}
        value={selectedModel?.modelId || ''}
        onValueChange={onSelect(handleModelChange)}
      >
        <SelectTrigger className="h-9 rounded-full border shadow-none hover:bg-accent disabled:hover:bg-transparent">
          <SelectValue
            placeholder={
              !models?.length ? 'No available models' : 'Select model'
            }
          >
            {selectedModel ? (
              <span className="flex items-center gap-2">
                <ModelIcon
                  image={
                    selectedModel.image || selectedModel.provider?.image || null
                  }
                  className="size-4"
                />
                <span className="text-sm font-medium">
                  {selectedModel.name}
                </span>
              </span>
            ) : null}
          </SelectValue>
        </SelectTrigger>
        {/* The popup is as wide as its widest row, not as wide as the
            trigger. shadcn pins it to the anchor, which is right for a select
            of short labels and wrong here: a row carries a name, a model id
            and its capability badges, and at the trigger's width they spill
            out from under the check. */}
        <SelectContent
          alignItemWithTrigger={false}
          className="w-auto max-w-[min(28rem,calc(100vw-2rem))] min-w-(--anchor-width)"
        >
          {models &&
            models.length > 0 &&
            Object.entries(groupedModels).map(
              ([providerId, providerModels]) => (
                <SelectGroup key={providerId}>
                  <SelectLabel className="flex items-center gap-2">
                    <ModelIcon
                      className="size-4 opacity-45 grayscale"
                      image={providerModels[0]?.provider?.image || null}
                    />
                    <span className="font-normal">
                      {providerModels[0]?.provider?.name || 'Unknown'}
                    </span>
                  </SelectLabel>
                  {providerModels.map(m => (
                    <SelectItem
                      key={m.modelId}
                      value={m.modelId}
                      label={`${m.name} ${m.modelId}`}
                      // `data-selected` is what Base UI marks the chosen row
                      // with. Base UI also puts the check last and the item
                      // already reserves room for it, so neither is overridden
                      // here — the rules that used to sit on this line were
                      // written against Radix, whose attribute is different
                      // and whose children are the other way round.
                      className="data-selected:bg-accent"
                    >
                      <span className="flex w-full items-start">
                        <ModelIcon
                          image={m.image || m.provider?.image || null}
                          className="mt-0.5 mr-2 size-4"
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="font-medium">{m.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {m.modelId}
                          </span>
                        </span>
                        {(m.supportsReasoning ||
                          m.supportsVision ||
                          m.supportsImageEdit ||
                          m.supportsImageToVideo ||
                          m.supportsVideoEdit) && (
                          <span className="ml-auto flex items-center gap-1 pt-0.5 pl-3">
                            {(m.supportsImageEdit ||
                              m.supportsImageToVideo) && (
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <span className="rounded bg-emerald-100 p-0.5 dark:bg-emerald-900/30">
                                      <Pencil className="size-3 text-emerald-600 dark:text-emerald-400" />
                                    </span>
                                  }
                                />
                                <TooltipContent>
                                  {m.supportsImageToVideo
                                    ? 'Can animate an existing image'
                                    : 'Can edit an existing image'}
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {m.supportsVideoEdit && (
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <span className="rounded bg-violet-100 p-0.5 dark:bg-violet-900/30">
                                      <Scissors className="size-3 text-violet-600 dark:text-violet-400" />
                                    </span>
                                  }
                                />
                                <TooltipContent>
                                  Can edit an existing video
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {m.supportsVision && (
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <span className="rounded bg-blue-100 p-0.5 dark:bg-blue-900/30">
                                      <Eye className="size-3 text-blue-600 dark:text-blue-400" />
                                    </span>
                                  }
                                />
                                <TooltipContent>Supports vision</TooltipContent>
                              </Tooltip>
                            )}
                            {m.supportsReasoning && (
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <span className="rounded bg-amber-100 p-0.5 dark:bg-amber-900/30">
                                      <Lightbulb className="size-3 text-amber-600 dark:text-amber-400" />
                                    </span>
                                  }
                                />
                                <TooltipContent>
                                  Supports reasoning
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )
            )}
        </SelectContent>
      </Select>

      {capability === 'chat' && selectedModel?.uiOptions?.reasoning && (
        <Button
          type="button"
          variant="outline"
          disabled={isDisabled}
          className={cn(
            'h-9 rounded-full px-3 font-normal text-muted-foreground shadow-none hover:text-muted-foreground',
            {
              'border-muted-foreground/30 bg-muted text-foreground hover:text-foreground':
                isReasoning
            }
          )}
          onClick={handleReasoningToggle}
        >
          <Lightbulb
            className={
              isReasoning ? 'fill-muted-foreground' : 'fill-muted-foreground/30'
            }
          />
          Think
        </Button>
      )}

      {/* Size selector for image capability */}
      {capability === 'image' && availableSizes.length > 0 && (
        <Select
          disabled={isDisabled}
          value={size || ''}
          onValueChange={onSelect(newSize =>
            onOptionsChange?.({ size: newSize })
          )}
        >
          <SelectTrigger className="h-9 rounded-full shadow-none">
            <span className="text-sm">
              {size ? ImageSizeLabels[size] || size : 'Size'}
            </span>
          </SelectTrigger>
          {/* The popup is as wide as its widest row, not as wide as the
            trigger. shadcn pins it to the anchor, which is right for a select
            of short labels and wrong here: a row carries a name, a model id
            and its capability badges, and at the trigger's width they spill
            out from under the check. */}
          <SelectContent
            alignItemWithTrigger={false}
            className="w-auto max-w-[min(28rem,calc(100vw-2rem))] min-w-(--anchor-width)"
          >
            {availableSizes.map(s => (
              <SelectItem key={s} value={s}>
                {ImageSizeLabels[s] || s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* AspectRatio selector for image & video capability */}
      {(capability === 'image' || capability === 'video') &&
        availableAspectRatios.length > 0 && (
          <Select
            disabled={isDisabled}
            value={aspectRatio || ''}
            onValueChange={onSelect(newRatio =>
              onOptionsChange?.({ aspectRatio: newRatio })
            )}
          >
            <SelectTrigger className="h-9 rounded-full shadow-none">
              <span className="text-sm">
                {aspectRatio
                  ? AspectRatioLabels[aspectRatio] || aspectRatio
                  : 'Aspect'}
              </span>
            </SelectTrigger>
            {/* The popup is as wide as its widest row, not as wide as the
            trigger. shadcn pins it to the anchor, which is right for a select
            of short labels and wrong here: a row carries a name, a model id
            and its capability badges, and at the trigger's width they spill
            out from under the check. */}
            <SelectContent
              alignItemWithTrigger={false}
              className="w-auto max-w-[min(28rem,calc(100vw-2rem))] min-w-(--anchor-width)"
            >
              {availableAspectRatios.map(r => (
                <SelectItem key={r} value={r}>
                  {AspectRatioLabels[r] || r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

      {/* Resolution selector for video capability */}
      {capability === 'video' && availableResolutions.length > 0 && (
        <Select
          disabled={isDisabled}
          value={resolution || ''}
          onValueChange={onSelect(newResolution =>
            onOptionsChange?.({ resolution: newResolution })
          )}
        >
          <SelectTrigger className="h-9 rounded-full shadow-none">
            <span className="text-sm">
              {resolution
                ? VideoResolutionLabels[resolution] || resolution
                : 'Resolution'}
            </span>
          </SelectTrigger>
          {/* The popup is as wide as its widest row, not as wide as the
            trigger. shadcn pins it to the anchor, which is right for a select
            of short labels and wrong here: a row carries a name, a model id
            and its capability badges, and at the trigger's width they spill
            out from under the check. */}
          <SelectContent
            alignItemWithTrigger={false}
            className="w-auto max-w-[min(28rem,calc(100vw-2rem))] min-w-(--anchor-width)"
          >
            {availableResolutions.map(r => (
              <SelectItem key={r} value={r}>
                {VideoResolutionLabels[r] || r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Duration selector for video capability */}
      {capability === 'video' && availableDurations.length > 0 && (
        <Select
          disabled={isDisabled}
          value={duration !== undefined ? String(duration) : ''}
          onValueChange={onSelect(newDuration => {
            const parsed = Number(newDuration);
            if (Number.isFinite(parsed)) {
              onOptionsChange?.({ duration: parsed });
            }
          })}
        >
          <SelectTrigger className="h-9 rounded-full shadow-none">
            <span className="text-sm">
              {duration !== undefined ? `${duration}s` : 'Duration'}
            </span>
          </SelectTrigger>
          {/* The popup is as wide as its widest row, not as wide as the
            trigger. shadcn pins it to the anchor, which is right for a select
            of short labels and wrong here: a row carries a name, a model id
            and its capability badges, and at the trigger's width they spill
            out from under the check. */}
          <SelectContent
            alignItemWithTrigger={false}
            className="w-auto max-w-[min(28rem,calc(100vw-2rem))] min-w-(--anchor-width)"
          >
            {availableDurations.map(d => (
              <SelectItem key={d} value={String(d)}>
                {`${d}s`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Voice selector for audio capability */}
      {capability === 'audio' && availableVoices.length > 0 && (
        <Select
          disabled={isDisabled}
          value={voice || ''}
          onValueChange={onSelect(newVoice =>
            onOptionsChange?.({ voice: newVoice })
          )}
        >
          <SelectTrigger className="h-9 rounded-full shadow-none">
            <span className="text-sm">
              {voice ? voice.charAt(0).toUpperCase() + voice.slice(1) : 'Voice'}
            </span>
          </SelectTrigger>
          {/* The popup is as wide as its widest row, not as wide as the
            trigger. shadcn pins it to the anchor, which is right for a select
            of short labels and wrong here: a row carries a name, a model id
            and its capability badges, and at the trigger's width they spill
            out from under the check. */}
          <SelectContent
            alignItemWithTrigger={false}
            className="w-auto max-w-[min(28rem,calc(100vw-2rem))] min-w-(--anchor-width)"
          >
            {availableVoices.map(v => (
              <SelectItem key={v} value={v}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
