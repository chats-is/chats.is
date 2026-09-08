import { useMemo } from 'react';

import { type ModelCapability, type ProviderType } from '@/types';
import { ReasoningEffortLabels } from '@/lib/constant';
import { vocabularyFor, type VocabField } from '@/lib/provider-vocab';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

/**
 * The two keys each option field occupies in a model's `uiOptions`: the list
 * of values the model accepts, and which of them it starts on.
 */
const KEYS: Record<
  VocabField,
  { list: string; single: string; label: string }
> = {
  aspectRatio: {
    list: 'aspectRatios',
    single: 'aspectRatio',
    label: 'Aspect ratio'
  },
  size: { list: 'sizes', single: 'size', label: 'Size' },
  resolution: {
    list: 'resolutions',
    single: 'resolution',
    label: 'Resolution'
  },
  duration: { list: 'durations', single: 'duration', label: 'Duration' },
  voice: { list: 'voices', single: 'voice', label: 'Voice' },
  effort: { list: 'efforts', single: 'effort', label: 'Effort' }
};

const FIELD_ORDER: VocabField[] = [
  'aspectRatio',
  'size',
  'resolution',
  'duration',
  'voice',
  'effort'
];

type OptionValue = string | number;

/**
 * One shape for every pill in this editor, values and the default alike. The
 * default's own control hides the chevron a Select would draw: it is the same
 * kind of thing as the values beside it, and a second shape would say
 * otherwise.
 */
const CHIP =
  // `data-[size=default]:h-auto` rather than `h-auto`: the Select trigger
  // sets its height through that same variant, and a plain utility does not
  // outrank an attribute selector — left alone it stays 36px tall and
  // stretches every chip beside it to match.
  // `disabled:opacity-100` overrides the Select trigger's own dimming: the
  // row it sits in is already dimmed as a whole, and two would compound.
  'h-auto w-auto rounded-full border px-2.5 py-1 text-xs leading-4 shadow-none transition-colors disabled:pointer-events-none disabled:opacity-100 data-[size=default]:h-auto [&_svg]:hidden';

const chipState = (on: boolean) =>
  on
    ? 'border-primary bg-primary text-primary-foreground'
    : 'border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground';

/**
 * The default wears the same pill as the values but not their colour: it is
 * not a fourth thing the model accepts, it is a pointer at one of the three.
 * Filled the same way, it would read as a duplicate of whichever value it
 * names.
 */
const defaultState = (set: boolean) =>
  set
    ? 'border-input bg-secondary font-medium text-secondary-foreground'
    : 'border-dashed border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground';

function chipLabel(field: VocabField, value: OptionValue): string {
  if (field === 'effort')
    return ReasoningEffortLabels[String(value)] ?? String(value);
  if (field === 'duration') return `${value}s`;
  return String(value);
}

/**
 * The visual editor for a model's `uiOptions`.
 *
 * It offers exactly the values the model's providers accept for its
 * capability — the catalogue decides, not the admin — so a size cannot be
 * typed at a model whose provider names its output by ratio, and a ratio
 * cannot be typed at one that has no such parameter. A model bound to several
 * providers gets the intersection, because the failover has to work on the day
 * it happens.
 *
 * The stored shape is unchanged: a JSON object of `xxx`/`xxxs` pairs. This
 * only stops it from being typed by hand.
 */
export function UiOptionsField({
  value,
  onChange,
  capability,
  providerTypes,
  supportsReasoning
}: {
  value: string;
  onChange: (next: string) => void;
  capability: ModelCapability;
  providerTypes: ProviderType[];
  /** A model that does not think has no effort to set and no thinking to show. */
  supportsReasoning: boolean;
}) {
  const parsed = useMemo<Record<string, unknown>>(() => {
    if (!value.trim()) return {};
    try {
      const json: unknown = JSON.parse(value);
      return json && typeof json === 'object' && !Array.isArray(json)
        ? (json as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }, [value]);

  const vocabulary = useMemo(
    () => vocabularyFor(providerTypes, capability),
    [providerTypes, capability]
  );

  const write = (next: Record<string, unknown>) => {
    // An empty object is stored as an empty field, which is how the form
    // already says "this model declares nothing".
    const cleaned = Object.fromEntries(
      Object.entries(next).filter(([, v]) =>
        Array.isArray(v) ? v.length > 0 : v !== undefined
      )
    );
    onChange(
      Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned, null, 2) : ''
    );
  };

  /**
   * What the model declares for a field, minus anything the catalogue does
   * not offer — a value stored before the vocabulary closed (the old `auto`
   * among them) is not something this editor can show or an admin can pick.
   * Toggling the field rewrites the list without it.
   */
  const selectedOf = (field: VocabField): OptionValue[] => {
    const list = parsed[KEYS[field].list];
    if (!Array.isArray(list)) return [];
    const allowed = vocabulary[field] ?? [];
    return (list as OptionValue[]).filter(value => allowed.includes(value));
  };

  const toggle = (field: VocabField, option: OptionValue) => {
    const { list, single } = KEYS[field];
    const current = selectedOf(field);
    const next = current.includes(option)
      ? current.filter(v => v !== option)
      : // Keep the catalogue's order rather than click order, so two models
        // with the same values read the same.
        (vocabulary[field] ?? []).filter(
          v => v === option || current.includes(v)
        );

    const draft = { ...parsed, [list]: next };
    // A default that is no longer offered is not a default.
    if (!next.includes(parsed[single] as OptionValue)) delete draft[single];
    write(draft);
  };

  const setDefault = (field: VocabField, option: string) => {
    const { single } = KEYS[field];
    const draft = { ...parsed };
    if (!option) delete draft[single];
    else draft[single] = field === 'duration' ? Number(option) : option;
    write(draft);
  };

  const fields = FIELD_ORDER.filter(field => vocabulary[field]?.length);

  /** Reasoning off does not remove the levels; it puts them out of reach. */
  const isDisabled = (field: VocabField) =>
    field === 'effort' && !supportsReasoning;

  if (fields.length === 0 && capability !== 'chat') {
    return (
      <p className="text-sm text-muted-foreground">
        The chosen providers accept no options for a {capability} model.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {fields.map(field => {
        const options = vocabulary[field] ?? [];
        const selected = selectedOf(field);
        // A default the model no longer offers is no default — which is also
        // how a legacy `"auto"` reads now that the vocabulary is closed and
        // has no such value in it.
        const stored = parsed[KEYS[field].single] as OptionValue | undefined;
        const current = selected.includes(stored as OptionValue)
          ? stored
          : undefined;

        const disabled = isDisabled(field);

        return (
          <div
            key={field}
            className={cn('space-y-2', disabled && 'opacity-50')}
          >
            <Label>{KEYS[field].label}</Label>
            {/* Boxed like an input: the values are the field's
                content, and the box says where it ends. */}
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input p-2 shadow-xs dark:bg-input/30">
              {/* The default leads the row it picks from, wearing the same
                  shape as the values — it is one of them, named twice. */}
              <Select
                value={current === undefined ? '' : String(current)}
                onValueChange={next => setDefault(field, next)}
                disabled={disabled || selected.length === 0}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SelectTrigger
                      className={cn(CHIP, defaultState(current !== undefined))}
                    >
                      <SelectValue placeholder="No default" />
                    </SelectTrigger>
                  </TooltipTrigger>
                  <TooltipContent>
                    Default {KEYS[field].label.toLowerCase()}
                  </TooltipContent>
                </Tooltip>
                <SelectContent>
                  {selected.map(option => (
                    <SelectItem key={String(option)} value={String(option)}>
                      {chipLabel(field, option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {options.map(option => {
                const isOn = selected.includes(option);
                return (
                  <button
                    key={String(option)}
                    type="button"
                    onClick={() => toggle(field, option)}
                    aria-pressed={isOn}
                    disabled={disabled}
                    className={cn(CHIP, chipState(isOn))}
                  >
                    {chipLabel(field, option)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {capability === 'chat' && (
        // A row of values like the others, holding the one value there is:
        // the chat's own Think button, offered or not. It does not show the
        // thinking — it decides whether the reader gets the switch that does.
        <div className={cn('space-y-2', !supportsReasoning && 'opacity-50')}>
          <Label>Thinking control</Label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input p-2 shadow-xs dark:bg-input/30">
            <button
              type="button"
              onClick={() =>
                write({
                  ...parsed,
                  reasoning: parsed.reasoning === true ? undefined : true
                })
              }
              aria-pressed={parsed.reasoning === true}
              disabled={!supportsReasoning}
              className={cn(CHIP, chipState(parsed.reasoning === true))}
            >
              Think
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
