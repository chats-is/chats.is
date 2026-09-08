import { useEffect, useMemo, useState } from 'react';
import { usePreferences } from '@/contexts/preferences-context';
import { type UseChatHelpers } from '@ai-sdk/react';
import { Eye, Lightbulb, Pencil, Scissors } from 'lucide-react';

import { type ChatMessage, type Model } from '@/types';
import { ReasoningEffortLabels } from '@/lib/constant';
import { chooseValue } from '@/lib/media-settings';
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
  /** Pre-filtered models to display */
  models: Model[];
  /** Current model value (controlled) */
  modelId: string;
  /** Callback when model changes */
  onModelChange: (modelId: string) => void;
  /** Callback when model options change (like the reasoning toggle) */
  onOptionsChange?: (options: ModelOptions) => void;
}

export interface ModelOptions {
  isReasoning?: boolean;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
}

export function ModelMenu({
  status,
  models,
  modelId,
  onModelChange,
  onOptionsChange
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

  // Tell the composer whether this model takes images, so the attach button
  // knows whether to offer them.
  useEffect(() => {
    if (!selectedModel) return;
    onOptionsChange?.({
      supportsVision: selectedModel.supportsVision ?? undefined
    });
  }, [selectedModel, onOptionsChange]);

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

  const handleReasoningToggle = () => {
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

  // How hard to think, where the model gives a say. Switching models can
  // leave a level the new one does not offer, so what is shown is settled
  // against its list rather than read straight from the preference.
  const efforts = selectedModel?.uiOptions?.efforts ?? [];
  const effort = chooseValue(
    efforts,
    preferences.chatEffort,
    selectedModel?.uiOptions?.effort
  );

  return (
    <div className="flex items-center space-x-2">
      <Select
        disabled={isDisabled}
        value={selectedModel?.modelId || ''}
        onValueChange={handleModelChange}
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
        <SelectContent position="popper">
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
                      textValue={`${m.name} ${m.modelId}`}
                      // No tick, and no room kept for one: the row it is on
                      // is already shaded, and the space at the right belongs
                      // to the badges that say what the model can do. Radix
                      // wraps the row in a span of its own that sizes to its
                      // content, so it has to be stretched or the badges sit
                      // against the name rather than the edge.
                      className="pr-2 data-[state=checked]:bg-accent [&>[data-slot=select-item-indicator]]:hidden [&>span:last-child]:w-full"
                    >
                      <span className="flex w-full items-start">
                        <ModelIcon
                          image={m.image || m.provider?.image || null}
                          className="mt-0.5 mr-2 size-4"
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="font-medium">{m.name}</span>
                          <span className="truncate text-xs text-muted-foreground">
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
                                <TooltipTrigger asChild>
                                  <span className="rounded bg-emerald-100 p-0.5 dark:bg-emerald-900/30">
                                    <Pencil className="size-3 text-emerald-600 dark:text-emerald-400" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {m.supportsImageToVideo
                                    ? 'Can animate an existing image'
                                    : 'Can edit an existing image'}
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {m.supportsVideoEdit && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="rounded bg-violet-100 p-0.5 dark:bg-violet-900/30">
                                    <Scissors className="size-3 text-violet-600 dark:text-violet-400" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Can edit an existing video
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {m.supportsVision && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="rounded bg-blue-100 p-0.5 dark:bg-blue-900/30">
                                    <Eye className="size-3 text-blue-600 dark:text-blue-400" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>Supports vision</TooltipContent>
                              </Tooltip>
                            )}
                            {m.supportsReasoning && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="rounded bg-amber-100 p-0.5 dark:bg-amber-900/30">
                                    <Lightbulb className="size-3 text-amber-600 dark:text-amber-400" />
                                  </span>
                                </TooltipTrigger>
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

      {efforts.length > 0 && (
        <Select
          disabled={isDisabled}
          value={effort ?? ''}
          onValueChange={value => setPreference('chatEffort', value)}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <SelectTrigger className="h-9 rounded-full shadow-none">
                <span className="text-sm">
                  {effort
                    ? (ReasoningEffortLabels[effort] ?? effort)
                    : 'Effort'}
                </span>
              </SelectTrigger>
            </TooltipTrigger>
            <TooltipContent>How hard the model thinks</TooltipContent>
          </Tooltip>
          <SelectContent position="popper">
            {efforts.map(value => (
              <SelectItem key={value} value={value}>
                {ReasoningEffortLabels[value] ?? value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {selectedModel?.uiOptions?.reasoning && (
        <Tooltip>
          {/* Wrapped in a span: a disabled button takes no pointer events, and
              the tooltip is most wanted exactly when it is disabled. */}
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                type="button"
                variant="outline"
                // Think decides whether the thinking is streamed back, and at the
                // `none` level there is none to stream. Disabled rather than
                // hidden: the model still offers the control, it just has nothing
                // to act on until the effort says otherwise.
                disabled={isDisabled || effort === 'none'}
                className={cn(
                  'h-9 rounded-full px-3 font-normal text-muted-foreground shadow-none hover:text-muted-foreground',
                  {
                    'border-muted-foreground/30 bg-muted text-foreground hover:text-foreground':
                      isReasoning && effort !== 'none'
                  }
                )}
                onClick={handleReasoningToggle}
              >
                <Lightbulb
                  className={
                    // Lit, in the same amber the model list uses to mark a model
                    // that thinks. Only the glass fills — the outline stays the
                    // button's own colour.
                    isReasoning && effort !== 'none'
                      ? 'fill-amber-300 dark:fill-amber-200'
                      : 'fill-muted-foreground/30'
                  }
                />
                Think
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {effort === 'none'
              ? 'Nothing to show at effort None'
              : 'Show the thinking'}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
