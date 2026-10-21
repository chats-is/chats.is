import { useEffect, useMemo, useState } from 'react';
import { usePreferences } from '@/contexts/preferences-context';
import { type UseChatHelpers } from '@ai-sdk/react';

import { type ChatMessage, type Model } from '@/types';
import { AUTO_OPTION, REASONING_EFFORT_LABELS } from '@/lib/constant';
import { chooseValue } from '@/lib/media-settings';
import { modelMatchesId } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { ModelSelect } from '@/components/model-select';

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
  /** Callback when what the model takes changes, such as images */
  onOptionsChange?: (options: ModelOptions) => void;
}

export interface ModelOptions {
  supportsVision?: boolean;
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

  // Handler for model change
  const handleModelChange = (newModel: string | null) => {
    if (!newModel) return;

    // Notify parent (parent handles saving to preferences)
    onModelChange(newModel);

    // Find the new model and notify about its options
    const newModelData = models?.find(m => m.modelId === newModel);
    if (newModelData) {
      onOptionsChange?.({
        supportsVision: newModelData.supportsVision ?? undefined
      });
    }
  };

  const isDisabled =
    status === 'submitted' || status === 'streaming' || !models?.length;

  // How hard to think, where the model gives a say: Auto, as every option
  // has, and the levels the model offers. Switching models can leave a level
  // the new one does not offer, so what is shown is settled against its list
  // rather than read straight from the preference.
  const levels = selectedModel?.uiOptions?.efforts ?? [];
  const efforts = levels.length > 0 ? [AUTO_OPTION, ...levels] : [];
  const effort = chooseValue(
    efforts,
    preferences.chatEffort,
    selectedModel?.uiOptions?.effort
  );

  return (
    <div className="flex items-center space-x-2">
      <ModelSelect
        groups={[{ label: 'Models', models: models ?? [] }]}
        value={modelId}
        onValueChange={handleModelChange}
        disabled={isDisabled}
      />

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
                  {effort ? effortLabel(effort) : 'Effort'}
                </span>
              </SelectTrigger>
            </TooltipTrigger>
            <TooltipContent>How hard the model thinks</TooltipContent>
          </Tooltip>
          <SelectContent position="popper">
            {efforts.map(value => (
              <SelectItem key={value} value={value}>
                {effortLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

/** How an effort reads in the menu, Auto among them. */
function effortLabel(value: string): string {
  return value === AUTO_OPTION
    ? 'Auto'
    : (REASONING_EFFORT_LABELS[value] ?? value);
}
