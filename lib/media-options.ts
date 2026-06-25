import { ModelUIOptions } from '@/types/model';

/**
 * 'auto' is a regular option value that admins put in a model's `uiOptions`
 * (e.g. `"aspectRatios": ["auto", "16:9"]`, default `"aspectRatio": "auto"`).
 * It flows through selection like any other value; only at the provider call
 * boundary does it resolve to "omit the parameter" via `resolveAutoOption`.
 */
export const AUTO_OPTION = 'auto';

/** Map the 'auto' option to undefined so the provider applies its own default. */
export function resolveAutoOption<T extends string | number>(
  value: T | undefined
): T | undefined {
  return value === AUTO_OPTION ? undefined : value;
}

/**
 * Resolve a generation option for a media generation call.
 *
 * With a declared allowed list (`uiOptions[listKey]`), precedence is:
 * LLM-requested value → user selection → model default → first option —
 * each accepted only when it appears in the list (admins constrain what a
 * model accepts and billing depends on it).
 *
 * Without a list the model renders no selector, so the request-body
 * "selection" can only be a stale value carried over from another model —
 * requested/selected are ignored entirely and the model's own default (or
 * nothing, i.e. the provider default) applies.
 *
 * An LLM-requested 'auto' is meaningless (omitting the field already means
 * auto) and is ignored; a selected/default 'auto' wins like any other value
 * and is resolved at the call boundary.
 */
function pickOption<T extends string | number>(
  requested: T | undefined,
  selected: T | undefined,
  allowed: T[] | undefined,
  fallback: T | undefined
): T | undefined {
  requested = resolveAutoOption(requested);

  if (!allowed?.length) {
    return fallback;
  }

  const isAllowed = (value: T | undefined): value is T =>
    value !== undefined && allowed.includes(value);

  if (isAllowed(requested)) {
    return requested;
  }
  if (isAllowed(selected)) {
    return selected;
  }
  if (isAllowed(fallback)) {
    return fallback;
  }
  return allowed[0];
}

export function pickAspectRatio(
  requested: string | undefined,
  selected: string | undefined,
  uiOptions?: ModelUIOptions | null
): `${number}:${number}` | undefined {
  return pickOption(
    requested,
    selected,
    uiOptions?.aspectRatios,
    uiOptions?.aspectRatio
  ) as `${number}:${number}` | undefined;
}

export function pickSize(
  requested: string | undefined,
  selected: string | undefined,
  uiOptions?: ModelUIOptions | null
): string | undefined {
  return pickOption(requested, selected, uiOptions?.sizes, uiOptions?.size);
}

export function pickDuration(
  requested: number | undefined,
  selected: number | undefined,
  uiOptions?: ModelUIOptions | null
): number | undefined {
  return pickOption(
    requested,
    selected,
    uiOptions?.durations,
    uiOptions?.duration
  );
}

export function pickResolution(
  requested: string | undefined,
  selected: string | undefined,
  uiOptions?: ModelUIOptions | null
): string | undefined {
  return pickOption(
    requested,
    selected,
    uiOptions?.resolutions,
    uiOptions?.resolution
  );
}

export function pickVoice(
  requested: string | undefined,
  selected: string | undefined,
  uiOptions?: ModelUIOptions | null
): string | undefined {
  return pickOption(requested, selected, uiOptions?.voices, uiOptions?.voice);
}
