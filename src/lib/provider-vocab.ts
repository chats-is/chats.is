import { type ModelCapability, type ProviderType } from '@/types';

/**
 * The option fields a model can declare. Unified across every provider — a
 * `resolution` is a `resolution` wherever it ends up — while the values each
 * one accepts are not, which is what the catalogue below is for.
 */
export type VocabField =
  'aspectRatio' | 'size' | 'resolution' | 'duration' | 'voice' | 'effort';

/** What a model may declare for one provider and one capability. */
export type Vocabulary = Partial<
  Record<VocabField, readonly (string | number)[]>
>;

/**
 * How hard a model may be asked to think. The AI SDK takes these as-is for
 * every provider behind it, so unlike the media fields there is nothing
 * per-provider to say. `'provider-default'` is not here: it is what an
 * unset effort resolves to, never something an admin lists.
 */
export const EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh'
] as const;

/**
 * Every option value this app can send, by provider and capability.
 *
 * Closed on purpose: each list is what the provider's own SDK enumerates, or
 * what its documentation enumerates where the SDK left the type open. A field
 * that is absent is a field that provider has no home for — `grok` ignores
 * `size` for images, OpenAI rejects an aspect ratio and asks for a size — and
 * the conversion below sends nothing for it rather than guessing.
 *
 * Sources, in the order a reader would want to check them:
 * - openai image sizes: `@ai-sdk/openai` `OpenAIImageModelOptions.size`
 * - openai video (Sora): `openai` `Videos.VideoSize`, `seconds` 4 | 8 | 12
 * - openai voices: `openai` `SpeechCreateParams.voice`
 * - google image + voices: `@ai-sdk/google` `imageConfig`, `DEFAULT_VOICE`
 * - google video: `@ai-sdk/google` inline video part (`resolution`)
 * - xai resolutions: `@ai-sdk/xai` `xaiImageModelOptions`, `resolutionSchema`
 * - xai ratios and voices: docs.x.ai (its SDK types them as bare strings)
 */
export const PROVIDER_VOCAB = {
  openai: {
    image: { size: ['1024x1024', '1024x1536', '1536x1024'] },
    video: {
      size: ['720x1280', '1280x720', '1024x1792', '1792x1024'],
      duration: [4, 8, 12]
    },
    audio: {
      voice: [
        'alloy',
        'ash',
        'ballad',
        'coral',
        'echo',
        'fable',
        'onyx',
        'nova',
        'sage',
        'shimmer',
        'verse',
        'marin',
        'cedar'
      ]
    },
    chat: { effort: EFFORTS }
  },
  google: {
    image: {
      aspectRatio: [
        '1:1',
        '2:3',
        '3:2',
        '3:4',
        '4:3',
        '4:5',
        '5:4',
        '9:16',
        '16:9',
        '21:9',
        '1:8',
        '8:1',
        '1:4',
        '4:1'
      ],
      resolution: ['512', '1K', '2K', '4K']
    },
    video: {
      aspectRatio: ['16:9', '9:16'],
      resolution: ['360p', '720p', '1080p', '4k']
    },
    audio: {
      voice: [
        'Kore',
        'Zephyr',
        'Puck',
        'Charon',
        'Fenrir',
        'Leda',
        'Orus',
        'Aoede',
        'Callirrhoe',
        'Autonoe',
        'Enceladus',
        'Iapetus',
        'Umbriel',
        'Algieba',
        'Despina',
        'Erinome',
        'Algenib',
        'Rasalgethi',
        'Laomedeia',
        'Achernar',
        'Alnilam',
        'Schedar',
        'Gacrux',
        'Pulcherrima',
        'Achird',
        'Zubenelgenubi',
        'Vindemiatrix',
        'Sadachbia',
        'Sadaltager',
        'Sulafat'
      ]
    },
    chat: { effort: EFFORTS }
  },
  xai: {
    image: {
      aspectRatio: [
        '1:1',
        '16:9',
        '9:16',
        '4:3',
        '3:4',
        '3:2',
        '2:3',
        '2:1',
        '1:2',
        '19.5:9',
        '9:19.5',
        '20:9',
        '9:20',
        '21:9',
        '5:2'
      ],
      resolution: ['1k', '2k']
    },
    video: {
      aspectRatio: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
      resolution: ['480p', '720p', '1080p'],
      duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    },
    audio: { voice: ['eve', 'ara', 'rex'] },
    chat: { effort: EFFORTS }
  },
  anthropic: { chat: { effort: EFFORTS } },
  deepseek: { chat: { effort: EFFORTS } },
  bedrock: { chat: { effort: EFFORTS } }
} as const satisfies Partial<
  Record<ProviderType, Partial<Record<ModelCapability, Vocabulary>>>
>;

/**
 * Azure serves OpenAI's models through OpenAI's own API, and Vertex serves
 * Google's — same fields, same values. Aliases rather than copies so the two
 * cannot drift apart.
 */
const VOCAB_ALIASES: Partial<
  Record<ProviderType, keyof typeof PROVIDER_VOCAB>
> = {
  azure: 'openai',
  vertex: 'google'
};

function vocabOf(
  type: ProviderType,
  capability: ModelCapability
): Vocabulary | undefined {
  const key = VOCAB_ALIASES[type] ?? type;
  const byCapability = PROVIDER_VOCAB[key as keyof typeof PROVIDER_VOCAB] as
    Partial<Record<ModelCapability, Vocabulary>> | undefined;
  return byCapability?.[capability];
}

/**
 * What a model bound to these providers may declare.
 *
 * The intersection, not the union: a model lists several providers so it can
 * fail over between them, and a value only one of them accepts would break
 * the generation on the day the failover actually happens. In practice the
 * pairs that share a `modelId` are the aliases above, which intersect
 * exactly.
 */
export function vocabularyFor(
  providerTypes: ProviderType[],
  capability: ModelCapability
): Vocabulary {
  const [first, ...rest] = providerTypes;
  if (!first) return {};

  let merged: Vocabulary = vocabOf(first, capability) ?? {};

  for (const type of rest) {
    const next = vocabOf(type, capability) ?? {};
    const narrowed: Vocabulary = {};
    for (const [field, values] of Object.entries(merged) as [
      VocabField,
      readonly (string | number)[]
    ][]) {
      const other = next[field];
      if (!other) continue;
      const kept = values.filter(value => other.includes(value));
      if (kept.length) narrowed[field] = kept;
    }
    merged = narrowed;
  }

  return merged;
}

/**
 * The voice each provider falls back to when a model pins none.
 *
 * These are the providers' own defaults, written down here rather than left
 * to the API: the fifth step of the option chain is the project's to decide,
 * and a voice is the one option where "the safe end of the scale" has no
 * meaning — every provider names a different set, none of which overlap, so
 * the only sane fixed value is per provider.
 */
const DEFAULT_VOICES: Partial<Record<ProviderType, string>> = {
  openai: 'alloy',
  google: 'Kore',
  xai: 'eve'
};

export function defaultVoice(type: ProviderType): string | undefined {
  return DEFAULT_VOICES[VOCAB_ALIASES[type] ?? type];
}

/**
 * Where one field goes in one provider's request.
 *
 * `top` is an AI SDK call parameter, `provider` is that provider's own
 * namespace in `providerOptions`, and `imageConfig` is the nested object
 * Gemini reads its image settings from. A field with no entry here is one the
 * provider has no parameter for, and is dropped.
 */
type Target = { at: 'top' | 'provider' | 'imageConfig'; key: string };

const TARGETS: Partial<
  Record<
    ProviderType,
    Partial<Record<ModelCapability, Partial<Record<VocabField, Target>>>>
  >
> = {
  openai: {
    image: { size: { at: 'top', key: 'size' } },
    // Sora is called directly rather than through the AI SDK, so `top` here
    // means its own request body. `duration` is absent because Sora buckets
    // it to 4/8/12 seconds at the call itself.
    video: { size: { at: 'top', key: 'size' } },
    audio: { voice: { at: 'top', key: 'voice' } }
  },
  google: {
    // Imagen, reached through `generateImage`, takes a ratio as a call
    // parameter and has no size of its own. Gemini reaches the same models
    // through `generateText` and reads both from a nested object — see
    // `INLINE_TARGETS`.
    image: { aspectRatio: { at: 'top', key: 'aspectRatio' } },
    video: {
      aspectRatio: { at: 'top', key: 'aspectRatio' },
      resolution: { at: 'top', key: 'resolution' },
      duration: { at: 'top', key: 'duration' }
    },
    audio: { voice: { at: 'top', key: 'voice' } }
  },
  xai: {
    image: {
      aspectRatio: { at: 'top', key: 'aspectRatio' },
      resolution: { at: 'provider', key: 'resolution' }
    },
    video: {
      aspectRatio: { at: 'top', key: 'aspectRatio' },
      resolution: { at: 'provider', key: 'resolution' },
      duration: { at: 'top', key: 'duration' }
    },
    audio: { voice: { at: 'top', key: 'voice' } }
  }
};

/**
 * Where Gemini reads its image settings when it is generating them inside a
 * text turn, which is the one call in this app that does not use the image
 * API at all.
 */
const INLINE_TARGETS: Partial<
  Record<ProviderType, Partial<Record<VocabField, Target>>>
> = {
  google: {
    aspectRatio: { at: 'imageConfig', key: 'aspectRatio' },
    resolution: { at: 'imageConfig', key: 'imageSize' }
  }
};

function targetsOf(
  type: ProviderType,
  capability: ModelCapability,
  inline: boolean
): Partial<Record<VocabField, Target>> {
  const key = VOCAB_ALIASES[type] ?? type;
  if (inline) return INLINE_TARGETS[key] ?? {};
  return TARGETS[key]?.[capability] ?? {};
}

type Placed = Record<string, string | number>;

export type RequestParts = {
  /** Parameters of the AI SDK call itself. */
  top: Placed;
  /** The provider's own namespace under `providerOptions`. */
  provider: Placed;
  /** Gemini's nested image settings, empty for everyone else. */
  imageConfig: Placed;
};

/**
 * Split settled option values into the places one provider expects them.
 *
 * Two things are dropped rather than sent. A field the provider has no
 * parameter for — which is how a size stops being sent to a model that names
 * its output by ratio, and how Sora stops being handed a `resolution` it has
 * never had. And a value outside what that provider accepts for that field:
 * the chain that settled it ends in fixed defaults chosen once for the whole
 * app, and one of those (`480p`, a video tier) is not a thing an image model
 * has ever taken. Sending it would fail the request; leaving it out lets the
 * provider apply its own default, which is what an unpinned option means.
 *
 * So this is the last place the vocabulary is closed, and the only one that
 * matters — the console offers admins nothing else, but a default settled
 * elsewhere never passed through the console at all.
 */
export function toRequestParts(
  type: ProviderType,
  capability: ModelCapability,
  values: Partial<Record<VocabField, string | number | undefined>>,
  /** Set for Gemini's image-inside-a-text-turn call, which addresses differently. */
  options?: { inline?: boolean }
): RequestParts {
  const targets = targetsOf(type, capability, options?.inline ?? false);
  const vocabulary = vocabularyFor([type], capability);
  const parts: RequestParts = { top: {}, provider: {}, imageConfig: {} };

  for (const [field, value] of Object.entries(values) as [
    VocabField,
    string | number | undefined
  ][]) {
    if (value === undefined) continue;
    if (!vocabulary[field]?.includes(value)) continue;
    const target = targets[field];
    if (!target) continue;
    if (target.at === 'top') parts.top[target.key] = value;
    else if (target.at === 'provider') parts.provider[target.key] = value;
    else parts.imageConfig[target.key] = value;
  }

  return parts;
}
