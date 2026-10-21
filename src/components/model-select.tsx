import {
  CircleDashed,
  Eye,
  Lightbulb,
  Pencil,
  Scissors,
  Star
} from 'lucide-react';

import { type Model } from '@/types';
import { cn, modelMatchesId } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { ModelIcon } from '@/components/model-icon';

/** Radix will not take an empty string as an item's value. */
const NO_MODEL = '__none__';

export interface ModelSelectProps {
  /**
   * The models offered. One group is listed by the provider a call would
   * reach first; more than one — the entries a prompt is tried on, say — by
   * their own names.
   */
  groups: Array<{ label: string; models: Model[] }>;
  /** The model chosen, by id or alias; null or empty for none. */
  value: string | null;
  /** Null for None. */
  onValueChange: (modelId: string | null) => void;
  /** Offers None, for no model at all. */
  empty?: boolean;
  /** Marked in the list: the model a prompt was written for. */
  recommendedId?: string | null;
  disabled?: boolean;
  className?: string;
}

/**
 * The user's model picker, as the composer shows it: the chosen model's mark
 * and name, and a list of each model's mark, name and id, with badges for
 * what it can do beyond words. Radix renders it differently on the server,
 * so a page that draws it there mounts it first (see `ModelMenu`).
 */
export function ModelSelect({
  groups,
  value,
  onValueChange,
  empty,
  recommendedId,
  disabled,
  className
}: ModelSelectProps) {
  const models = groups.flatMap(group => group.models);
  const selectedModel = models.find(m => modelMatchesId(m, value));

  // One list is grouped by the provider a call would reach first — the head
  // of the priority-ordered list; several by their own names.
  const listed =
    groups.length > 1
      ? groups.map(group => ({
          key: group.label,
          label: <span className="font-normal">{group.label}</span>,
          models: group.models
        }))
      : Object.values(
          models
            .filter(m => m.providers?.[0]?.provider)
            .reduce(
              (acc, m) => {
                const provider = m.providers![0].provider!;
                (acc[provider.id] ??= { provider, models: [] }).models.push(m);
                return acc;
              },
              {} as Record<
                string,
                {
                  provider: NonNullable<
                    NonNullable<Model['providers']>[number]['provider']
                  >;
                  models: Model[];
                }
              >
            )
        ).map(({ provider, models }) => ({
          key: provider.id,
          label: (
            <>
              <ModelIcon
                // Named rather than inherited: the icon now carries a
                // colour of its own, so the group label's muted tone has
                // to be asked for.
                className="size-4 text-muted-foreground opacity-45 grayscale"
                image={provider.image || null}
              />
              <span className="font-normal">{provider.name || 'Unknown'}</span>
            </>
          ),
          models
        }));

  // Ignore empty values (Radix Select fires empty change during hydration)
  const handleValueChange = (next: string) => {
    if (!next) return;
    onValueChange(next === NO_MODEL ? null : next);
  };

  return (
    <Select
      disabled={disabled || !models.length}
      value={selectedModel?.modelId || (empty ? NO_MODEL : '')}
      onValueChange={handleValueChange}
    >
      <SelectTrigger
        className={cn(
          'h-9 rounded-full border shadow-none hover:bg-accent disabled:hover:bg-transparent',
          className
        )}
      >
        <SelectValue
          placeholder={!models.length ? 'No available models' : 'Select model'}
        >
          {selectedModel ? (
            <span className="flex items-center gap-2">
              <ModelIcon
                image={
                  selectedModel.image ||
                  selectedModel.providers?.[0]?.provider?.image ||
                  null
                }
                className="size-4"
              />
              <span className="text-sm font-medium">{selectedModel.name}</span>
              {selectedModel.modelId === recommendedId && <RecommendedMark />}
            </span>
          ) : empty ? (
            <NoModel />
          ) : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper">
        {empty && (
          <SelectItem value={NO_MODEL}>
            <NoModel />
          </SelectItem>
        )}
        {listed.map(group => (
          <SelectGroup key={group.key}>
            <SelectLabel className="flex items-center gap-2">
              {group.label}
            </SelectLabel>
            {group.models.map(m => (
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
                    image={m.image || m.providers?.[0]?.provider?.image || null}
                    className="mt-0.5 mr-2 size-4"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{m.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {m.modelId}
                    </span>
                  </span>
                  <ModelBadges
                    model={m}
                    recommended={m.modelId === recommendedId}
                  />
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

/** None, as the console's selectors say it too: the dashed mark in the
 *  place a model's sits, and the word. */
function NoModel() {
  return (
    <span className="flex items-center gap-2 text-muted-foreground">
      <CircleDashed className="size-4" />
      None
    </span>
  );
}

/** The model a prompt was written for: in the list beside its badges, and
 *  beside its name once chosen. */
function RecommendedMark() {
  return <Star className="size-3 fill-yellow-400 text-yellow-400" />;
}

/** What a model can do beyond words, and whether it is the one a prompt
 *  was written for. */
function ModelBadges({
  model: m,
  recommended
}: {
  model: Model;
  recommended: boolean;
}) {
  if (
    !recommended &&
    !m.supportsReasoning &&
    !m.supportsVision &&
    !m.supportsImageEdit &&
    !m.supportsImageToVideo &&
    !m.supportsVideoEdit
  ) {
    return null;
  }
  return (
    <span className="ml-auto flex items-center gap-1 pt-0.5 pl-3">
      {recommended && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="p-0.5">
              <RecommendedMark />
            </span>
          </TooltipTrigger>
          <TooltipContent>Recommended</TooltipContent>
        </Tooltip>
      )}
      {(m.supportsImageEdit || m.supportsImageToVideo) && (
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
          <TooltipContent>Can edit an existing video</TooltipContent>
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
          <TooltipContent>Supports reasoning</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}
