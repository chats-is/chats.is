import {
  type ModelUIOptions,
  type ReasoningEffort,
  type SentEffort
} from '@/types/model';

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
 * Precedence is: user selection → LLM-requested value → model default →
 * first option, each accepted only when the model's list allows it (admins
 * constrain what a model accepts and billing depends on it).
 *
 * The selection comes first because it is the only step where someone said
 * what they wanted. The model's request is a guess made from the wording —
 * and it guesses even when the wording says nothing, picking a value out of
 * the list the tool description shows it. Letting that overrule a menu the
 * reader set on purpose makes the menu unreliable, and for a duration it
 * silently changes the bill. A menu left on `auto` is not a selection, so
 * the model still decides wherever nobody pinned anything.
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

  const chosen = isAllowed(selected)
    ? selected
    : isAllowed(requested)
      ? requested
      : isAllowed(fallback)
        ? fallback
        : allowed[0];

  return chosen as Exclude<T, typeof AUTO_OPTION>;
}

/**
 * The last step of the chain: what a generation uses when nothing above it
 * said anything — no request, no selection, and a model that declares neither
 * a list nor a default of its own.
 *
 * Belongs here rather than in each provider's call, which is where it used to
 * live for one of them and nowhere for the rest. The point of the chain is
 * that the value is settled before anyone talks to a provider, and a chain
 * that can still end in nothing has not settled it.
 *
 * The values are chosen to be the safe end of every scale: the ratio the most
 * models accept, and the smallest, shortest, cheapest of everything else.
 * Nobody is surprised by a bill for these.
 */
export const OPTION_DEFAULTS = {
  /** Square: the one ratio essentially every image and video model takes. */
  aspectRatio: '1:1',
  /** The smallest square in general use; 256 and 512 are DALL·E-2 vintage. */
  size: '1024x1024',
  /** The lowest rung this app names. */
  resolution: '480p',
  /** The shortest clip anything generates. */
  duration: 4,
  /** The provider's own idea of how hard to think, which is the safe end. */
  effort: 'provider-default'
} as const;

export function pickAspectRatio(
  requested: string | undefined,
  selected: string | undefined,
  uiOptions?: ModelUIOptions | null
): `${number}:${number}` {
  return (pickOption(
    requested,
    selected,
    uiOptions?.aspectRatios,
    uiOptions?.aspectRatio
  ) ?? OPTION_DEFAULTS.aspectRatio) as `${number}:${number}`;
}

export function pickSize(
  requested: string | undefined,
  selected: string | undefined,
  uiOptions?: ModelUIOptions | null
): string {
  return (
    pickOption(requested, selected, uiOptions?.sizes, uiOptions?.size) ??
    OPTION_DEFAULTS.size
  );
}

export function pickDuration(
  requested: number | undefined,
  selected: number | undefined,
  uiOptions?: ModelUIOptions | null
): number {
  return (
    pickOption(
      requested,
      selected,
      uiOptions?.durations,
      uiOptions?.duration
    ) ?? OPTION_DEFAULTS.duration
  );
}

export function pickResolution(
  requested: string | undefined,
  selected: string | undefined,
  uiOptions?: ModelUIOptions | null
): string {
  return (
    pickOption(
      requested,
      selected,
      uiOptions?.resolutions,
      uiOptions?.resolution
    ) ?? OPTION_DEFAULTS.resolution
  );
}

/**
 * How hard the model should think.
 *
 * The values go straight to the AI SDK, which hands them to whichever
 * provider is behind the model — so an effort settled here needs no
 * translation into one vendor's spelling. Nothing pinned means
 * `'provider-default'`, the SDK's own way of saying the same.
 */
export function pickEffort(
  requested: string | undefined,
  selected: string | undefined,
  uiOptions?: ModelUIOptions | null
): SentEffort {
  // The two inputs are strings off the wire; the cast only lets them be
  // compared against the declared list, which is what decides whether either
  // is used at all.
  return (
    pickOption(
      requested as ReasoningEffort | undefined,
      selected as ReasoningEffort | undefined,
      uiOptions?.efforts,
      uiOptions?.effort
    ) ?? OPTION_DEFAULTS.effort
  );
}

/**
 * Which voice to speak in.
 *
 * The one option with no project-wide fixed value at the end: OpenAI's
 * `alloy`, Google's `Kore` and xAI's `eve` name nothing in common, so a
 * model that declares no voices leaves this undefined and the provider
 * actually reached fills it in from `defaultVoice`.
 */
export function pickVoice(
  requested: string | undefined,
  selected: string | undefined,
  uiOptions?: ModelUIOptions | null
): string | undefined {
  return pickOption(requested, selected, uiOptions?.voices, uiOptions?.voice);
}
