import { type ModelUIOptions } from '@/types/model';

/**
 * 'auto' is a regular option value that admins put in a model's `uiOptions`
 * (e.g. `"aspectRatios": ["auto", "16:9"]`, default `"aspectRatio": "auto"`).
 * It flows through selection like any other value; only at the provider call
 * boundary does it resolve to "omit the parameter" via `resolveAutoOption`.
 */
export const AUTO_OPTION = 'auto';

/**
 * Map the 'auto' option to undefined so the provider applies its own default.
 *
 * The return type drops the literal: a caller that has resolved a value is
 * holding something the provider can take, and should not have to prove it
 * again.
 */
export function resolveAutoOption<T extends string | number>(
  value: T | undefined
): Exclude<T, typeof AUTO_OPTION> | undefined {
  return value === AUTO_OPTION
    ? undefined
    : (value as Exclude<T, typeof AUTO_OPTION>);
}

/**
 * Resolve a generation option for a media generation call.
 *
 * Precedence is: LLM-requested value → user selection → model default →
 * first option, each accepted only when the model's list allows it (admins
 * constrain what a model accepts and billing depends on it).
 *
 * `auto` is not a value; it is the absence of one. Choosing it in the menu
 * says "I am not pinning this", so it drops out at whichever step it appears
 * — a request, a selection, a model default — and the next step decides. It
 * is filtered from the list for the same reason, so "first option" means the
 * first real one.
 *
 * What comes out is therefore something the model declared it accepts, chosen
 * here rather than left to the provider. Only a model that declares nothing
 * at all — no list and no default — resolves to `undefined`, and then the
 * call site supplies its own value.
 */
function pickOption<T extends string | number>(
  requested: T | undefined,
  selected: T | undefined,
  list: T[] | undefined,
  fallback: T | undefined
): Exclude<T, typeof AUTO_OPTION> | undefined {
  const allowed = list?.filter(value => value !== AUTO_OPTION);

  if (!allowed?.length) {
    return resolveAutoOption(fallback);
  }

  const isAllowed = (value: T | undefined): value is T =>
    value !== undefined && allowed.includes(value);

  const chosen = isAllowed(requested)
    ? requested
    : isAllowed(selected)
      ? selected
      : isAllowed(fallback)
        ? fallback
        : allowed[0];

  return chosen as Exclude<T, typeof AUTO_OPTION>;
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
