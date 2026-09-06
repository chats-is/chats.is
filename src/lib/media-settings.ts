import {
  AspectRatioLabels,
  ImageSizeLabels,
  VideoResolutionLabels
} from '@/lib/constant';
import { type ModelUIOptions } from '@/types/model';

/**
 * The generation options a media model exposes, as the settings menu needs
 * them: one list of allowed values per option, already turned into strings.
 *
 * Everything an admin allows lives on the model's `uiOptions` — `sizes` with a
 * default `size`, `durations` with a default `duration`, and so on. The menu
 * offers a row per option that has a list, and nothing where the model has no
 * say, so a model that fixes its resolution simply shows no Resolution row.
 *
 * Values are strings here because that is what a menu's radio group compares
 * with; `duration` converts back to a number where it is stored.
 */
export type MediaOptionKey =
  | 'size'
  | 'aspectRatio'
  | 'resolution'
  | 'duration'
  | 'voice';

const LIST_KEY = {
  size: 'sizes',
  aspectRatio: 'aspectRatios',
  resolution: 'resolutions',
  duration: 'durations',
  voice: 'voices'
} as const satisfies Record<MediaOptionKey, keyof ModelUIOptions>;

export const MediaOptionLabels: Record<MediaOptionKey, string> = {
  size: 'Size',
  aspectRatio: 'Aspect ratio',
  resolution: 'Resolution',
  duration: 'Duration',
  voice: 'Voice'
};

/** The values this model allows for an option, in the order the admin listed. */
export function allowedValues(
  uiOptions: ModelUIOptions | null | undefined,
  key: MediaOptionKey
): Array<string> {
  const list = uiOptions?.[LIST_KEY[key]];
  if (!Array.isArray(list)) return [];
  return list
    .map(value => (typeof value === 'number' ? String(value) : value))
    .filter((value): value is string => typeof value === 'string');
}

/** The value this model prefers when nothing has been chosen. */
export function defaultValue(
  uiOptions: ModelUIOptions | null | undefined,
  key: MediaOptionKey
): string | undefined {
  const value = uiOptions?.[key];
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' ? value : undefined;
}

/**
 * What the option should read after a model change.
 *
 * The value in hand wins when the new model still allows it, so switching
 * models keeps a choice that both understand. Otherwise the new model's own
 * default applies, and failing that its first allowed value — never nothing,
 * because a row with no value would offer no hint of what will be generated.
 */
export function chooseValue(
  allowed: Array<string>,
  current: string | undefined,
  fallback: string | undefined
): string | undefined {
  if (allowed.length === 0) return undefined;
  if (current && allowed.includes(current)) return current;
  if (fallback && allowed.includes(fallback)) return fallback;
  return allowed[0];
}

/** How a value reads in the menu — the admin's own wording where there is one. */
export function optionLabel(key: MediaOptionKey, value: string): string {
  switch (key) {
    case 'size':
      return ImageSizeLabels[value] ?? value;
    case 'aspectRatio':
      return AspectRatioLabels[value] ?? value;
    case 'resolution':
      return VideoResolutionLabels[value] ?? value;
    case 'duration':
      return `${value}s`;
    case 'voice':
      return value.charAt(0).toUpperCase() + value.slice(1);
  }
}
