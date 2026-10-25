import '@tanstack/react-start/server-only';

import { cache } from 'react';
import {
  and,
  count,
  eq,
  ilike,
  inArray,
  notInArray,
  or,
  type SQL
} from 'drizzle-orm';
import { type z } from 'zod';

import {
  type ChatUsage,
  type PriceSnapshot,
  type PricingRecord
} from '@/types';
import { pageWindow } from '@/types/pagination';
import {
  strayRatesOf,
  type PricingKind,
  type pricingListSchema,
  type pricingUpsertSchema
} from '@/types/pricing';
import { PRICING_MODES } from '@/lib/constant';
import { generateUUID, parseNumber } from '@/lib/utils';
import { db } from '@/db';
import { modelPricings, modelProviders, models, providers } from '@/db/schema';
import { PublicError } from '@/server/public-error';

const EMPTY_SNAPSHOT: PriceSnapshot = {
  inputPrice: null,
  outputPrice: null,
  cacheReadPrice: null,
  cacheWritePrice: null,
  reasoningPrice: null,
  webSearchPrice: null,
  xPostPrice: null,
  xProfilePrice: null,
  imagePrice: null,
  imageInputPrice: null,
  imageOutputPrice: null,
  videoPrice: null,
  videoSecondsPrice: null,
  videoTokensPrice: null,
  audioInputPrice: null,
  audioOutputPrice: null,
  audioCharactersPrice: null,
  audioMinutePrice: null
};

/** Coerce a numeric-column string to a number, defaulting to 0 (cost math
 *  treats an unset rate as free). Thin wrapper over the shared `parseNumber`. */
const toNum = (v: string | null | undefined): number => parseNumber(v) ?? 0;

const numToStr = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
};

/**
 * Fetch the pricing row for a given model's modelId string (e.g. "gpt-4o").
 * One row per model. `cache()`-wrapped — preflightGate and recordChatUsage
 * both call this in the same request; cache deduplicates within the request.
 */
export const getPricingByModelKey = cache(
  async (modelKey: string): Promise<PricingRecord | null> => {
    const result = await db
      .select()
      .from(modelPricings)
      .where(eq(modelPricings.modelId, modelKey))
      .limit(1);
    return result[0] ?? null;
  }
);

export class PricingMissingError extends Error {
  /**
   * Message shown to whoever made the request. It names the actual cause —
   * pricing is not set — rather than calling the model "unavailable", which
   * sent people off to pick a different model when the fix is a one-time
   * configuration. Providers, models and pricing are all admin-managed in this
   * product, so pointing at the Pricing console is the actionable answer.
   *
   * `.message` stays the log line: same facts, phrased for the server log.
   */
  public userMessage: string;

  constructor(modelLabel: string, missingFields?: string[]) {
    const detail = missingFields?.length
      ? `missing ${missingFields.join(', ')}`
      : undefined;
    const suffix = detail
      ? `: ${detail}.`
      : '. Set a price (or 0) in the Pricing console.';
    super(`Model ${modelLabel} is not configured for billing${suffix}`);
    this.name = 'PricingMissingError';
    this.userMessage = missingFields?.length
      ? `${modelLabel} is missing pricing for ${missingFields.join(', ')}. Fill it in under Console → Pricing.`
      : `${modelLabel} has no pricing yet. Set it under Console → Pricing (0 is fine) to enable the model.`;
  }
}

/**
 * Required-field rules per capability — must match the admin-side validation
 * in `server/api/routers/pricing.ts`. Cache R/W are not required.
 *
 *   chat   → Input + Output (both must be set).
 *   image  → Image (per item), a rate for one resolution at least, OR
 *            token-based (Input + Image output), e.g. gpt-image-1 bills per
 *            token while DALL-E bills per image. Image input and Output fall
 *            back to Input and Image output.
 *   video  → Per video, Per second, a rate for one resolution at least, or
 *            Per 1M tokens.
 *   audio  → direction-aware: TTS bills per character or per token; STT
 *            (opts.transcription) bills per minute. Without the direction
 *            hint, any of the three satisfies (legacy callers).
 *
 * Returns the user-facing labels of the missing required fields, empty when valid.
 */
export function pricingMissingFields(
  capability: 'chat' | 'image' | 'video' | 'audio',
  p: PricingRecord,
  opts?: { transcription?: boolean }
): string[] {
  const set = (x: string | null) => x !== null;
  switch (capability) {
    case 'chat': {
      const m: string[] = [];
      if (!set(p.input)) m.push('Input');
      if (!set(p.output)) m.push('Output');
      return m;
    }
    case 'image':
      // Per-image OR token-based pricing satisfies an image model.
      return set(p.image) ||
        pricedByResolution(p) ||
        (set(p.input) && set(p.imageOutput))
        ? []
        : ['Image, a resolution, or Input + Image output'];
    case 'video':
      return set(p.video) ||
        set(p.videoSeconds) ||
        pricedByResolution(p) ||
        set(p.videoTokens)
        ? []
        : ['Per video / Per second / a resolution / Per 1M tokens'];
    case 'audio': {
      // TTS bills per character, STT per minute, and either per token: the
      // words and the audio each at its rate — a speech reads words and
      // speaks audio, a transcription hears audio and writes words. The
      // billed dimension must match the model's direction — a mismatched
      // style would pass the gate but compute $0 cost.
      const speechTokens = set(p.input) && set(p.audioOutput);
      const transcriptTokens = set(p.audioInput) && set(p.output);
      if (opts?.transcription === true) {
        return set(p.audioMinute) || transcriptTokens
          ? []
          : ['Per minute, or Audio input + Output'];
      }
      if (opts?.transcription === false) {
        return set(p.audioCharacters) || speechTokens
          ? []
          : ['Per 1M characters, or Input + Audio output'];
      }
      return set(p.audioCharacters) ||
        set(p.audioMinute) ||
        speechTokens ||
        transcriptTokens
        ? []
        : ['Per 1M characters, Per minute, or per-token rates'];
    }
  }
}

/**
 * Throw PricingMissingError if a model has no pricing row OR if the existing
 * row is missing fields that the model's capability requires.
 *
 * Used by API routes as the gatekeeper before any quota check.
 */
export async function requirePricing(
  modelKey: string,
  capability: 'chat' | 'image' | 'video' | 'audio',
  modelLabel: string,
  opts?: { transcription?: boolean }
): Promise<PricingRecord> {
  const pricing = await getPricingByModelKey(modelKey);
  if (!pricing) throw new PricingMissingError(modelLabel);
  const missing = pricingMissingFields(capability, pricing, opts);
  if (missing.length > 0) {
    throw new PricingMissingError(modelLabel, missing);
  }
  return pricing;
}

/**
 * Resolve a model by its modelId string (e.g. "gpt-4o") plus its pricing.
 * Falls back to alias match if no direct hit.
 *
 * Used by usage-record writers: they need both the canonical model row
 * (for modelId / providerId) AND the pricing snapshot. Pricing lookup
 * (without model) — use `getPricingByModelKey`.
 */
export const resolveModelByKey = cache(
  async (
    modelKey: string,
    capability?: 'chat' | 'image' | 'video' | 'audio'
  ): Promise<{
    model: typeof models.$inferSelect;
    pricing: PricingRecord | null;
  } | null> => {
    const allModels = await db.query.models.findMany({
      where: capability ? eq(models.capability, capability) : undefined,
      with: { pricings: { limit: 1 } }
    });

    const match = allModels.find(m => {
      if (m.modelId === modelKey) return true;
      const aliases = m.aliases;
      return aliases?.includes(modelKey) ?? false;
    });

    if (!match) return null;

    return {
      model: match,
      pricing: match.pricings[0] ?? null
    };
  }
);

/**
 * What a call's price did not bill, for its usage row to say:
 *   - `unsupported`: the way it is priced, by its name in the console, where
 *     the model does not report what that way needs — the call billed
 *     nothing, a pricing to change;
 *   - `unpriced`: what it used, by its rate's name in the console, where that
 *     rate is not set — those billed nothing, a price to set.
 * A rate set to 0 is free, and says nothing.
 */
export type BillingIssues = { unsupported?: string; unpriced: string[] };

type Billed = { cost: number; snapshot: PriceSnapshot; issues: BillingIssues };

const UNPRICED_NONE: BillingIssues = { unpriced: [] };

/** A way of pricing by the name the console's tab gives it. */
const modeName = (kind: PricingKind, value: string): string =>
  PRICING_MODES[kind].find(mode => mode.value === value)?.label ?? value;

/** Of what a call used, by its rate's name, how much, and the rate billed:
 *  the names of those used whose rate is not set. */
const unpricedOf = (
  used: Array<[name: string, count: number, rate: string | null]>
): string[] =>
  used
    .filter(([, count, rate]) => count > 0 && rate === null)
    .map(([name]) => name);

/**
 * Calculate the cost of a chat completion in USD.
 *
 * `usage` MUST be the normalized, mutually-exclusive buckets produced by
 * `normalizeChatUsage` (lib/chat-usage.ts) — `inputTokens` is plain (uncached)
 * input and `outputTokens` is text-only (reasoning excluded). Because the
 * buckets are disjoint, cost is plain per-dimension multiplication with no
 * subtraction, so the cached/reasoning portions can never be double-billed.
 *
 * Token counts are absolute (not per-million).
 *   - Cache R/W: billed strictly at their configured rate, never at the
 *     input rate; one not set bills its tokens at nothing, and says so.
 *   - Reasoning: billed at `pricing.reasoning` when set; otherwise falls back
 *     to `pricing.output` (the convention for OpenAI o-series, Anthropic
 *     thinking, Google, DeepSeek). Qwen-style models with a distinct rate
 *     should set `pricing.reasoning` explicitly. Snapshot records the rate
 *     actually used so each usage row is self-auditable.
 */
export function calculateChatCost(
  usage: ChatUsage,
  pricing: PricingRecord | null
): Billed {
  if (!pricing) {
    return { cost: 0, snapshot: { ...EMPTY_SNAPSHOT }, issues: UNPRICED_NONE };
  }

  const inputRate = toNum(pricing.input);
  const outputRate = toNum(pricing.output);
  const cacheReadRate = toNum(pricing.cacheRead);
  const cacheWriteRate = toNum(pricing.cacheWrite);

  // Reasoning: explicit rate wins; otherwise fall back to output rate.
  const reasoningRateStr = pricing.reasoning ?? pricing.output;
  const reasoningRate = toNum(reasoningRateStr);

  // Disjoint buckets (see normalizeChatUsage): bill each at its own rate.
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
  const reasoningTokens = usage.reasoningTokens ?? 0;
  // Searches are counted, not measured in tokens: the rate is per thousand,
  // as providers quote it.
  const webSearches = usage.webSearches ?? 0;
  const webSearchRate = toNum(pricing.webSearch);
  // A search of X is billed by what it fetched, each per thousand too.
  const xPosts = usage.xPosts ?? 0;
  const xProfiles = usage.xProfiles ?? 0;

  const cost =
    (inputTokens * inputRate) / 1_000_000 +
    (cacheReadTokens * cacheReadRate) / 1_000_000 +
    (cacheWriteTokens * cacheWriteRate) / 1_000_000 +
    (outputTokens * outputRate) / 1_000_000 +
    (reasoningTokens * reasoningRate) / 1_000_000 +
    (webSearches * webSearchRate) / 1_000 +
    (xPosts * toNum(pricing.xPost)) / 1_000 +
    (xProfiles * toNum(pricing.xProfile)) / 1_000;

  return {
    cost: roundCost(cost),
    snapshot: {
      ...EMPTY_SNAPSHOT,
      inputPrice: numToStr(pricing.input),
      outputPrice: numToStr(pricing.output),
      cacheReadPrice: numToStr(pricing.cacheRead),
      cacheWritePrice: numToStr(pricing.cacheWrite),
      reasoningPrice: numToStr(reasoningRateStr),
      webSearchPrice: numToStr(pricing.webSearch),
      xPostPrice: numToStr(pricing.xPost),
      xProfilePrice: numToStr(pricing.xProfile)
    },
    issues: {
      unpriced: unpricedOf([
        ['Input', inputTokens, pricing.input],
        ['Output', outputTokens, pricing.output],
        ['Reasoning', reasoningTokens, reasoningRateStr],
        ['Cache read', cacheReadTokens, pricing.cacheRead],
        ['Cache write', cacheWriteTokens, pricing.cacheWrite],
        ['Web search', webSearches, pricing.webSearch],
        ['X posts', xPosts, pricing.xPost],
        ['X profiles', xProfiles, pricing.xProfile]
      ])
    }
  };
}

/** Priced per resolution: a rate set for one size or resolution at least. */
export const pricedByResolution = (pricing: {
  resolutionPrices?: Record<string, string> | null;
}): boolean => Object.keys(pricing.resolutionPrices ?? {}).length > 0;

/**
 * Priced per resolution, the rate of the size or resolution a call was made
 * at — or, where it has none set or the call sent none (an edit keeps its
 * source's), the highest of those set.
 */
function resolutionRate(
  pricing: PricingRecord,
  resolution: string | undefined
): string | null {
  const prices = pricing.resolutionPrices ?? {};
  const own = resolution !== undefined ? prices[resolution] : undefined;
  if (own !== undefined) return own;
  return Object.values(prices).reduce<string | null>(
    (highest, rate) =>
      highest === null || toNum(rate) > toNum(highest) ? rate : highest,
    null
  );
}

/**
 * Cost for an image generation call.
 *
 * Billed per image, per image at the rate of the size or resolution it was
 * made at (see `resolutionRate`), or per token. Per token, the pictures read
 * and drawn are priced apart from the words, as providers price them: of the
 * input and output tokens, `imageInputTokens` and `imageOutputTokens` were pictures and
 * the rest words. A picture read with no rate of its own is billed at the
 * input rate, and words written with none at the image output rate — a row
 * priced on two rates is billed as one priced on all four would be, with the
 * missing ones equal to those.
 */
export function calculateImageCost(
  args: {
    imageCount: number;
    inputTokens?: number;
    outputTokens?: number;
    imageInputTokens?: number;
    imageOutputTokens?: number;
    /** The size or resolution sent. */
    resolution?: string;
  },
  pricing: PricingRecord | null
): Billed {
  if (!pricing) {
    return { cost: 0, snapshot: { ...EMPTY_SNAPSHOT }, issues: UNPRICED_NONE };
  }

  // Mutually-exclusive billing styles, per resolution and per image first:
  //   - per resolution (xAI): imageCount × the rate of its resolution
  //   - per-image  (DALL-E / imagen): imageCount × the image rate
  //   - per-token  (gpt-image-1 ...): each kind of token at its rate
  // A model only ever configures one. Checking per-image first avoids
  // double-charging if both happen to be set (misconfig / dirty sync).
  // A per-image rate of 0 is set, and bills each image at nothing.
  const byResolution = pricedByResolution(pricing);
  if (byResolution || pricing.image != null) {
    const perImage = byResolution
      ? resolutionRate(pricing, args.resolution)
      : pricing.image;
    return {
      cost: roundCost(args.imageCount * toNum(perImage)),
      snapshot: { ...EMPTY_SNAPSHOT, imagePrice: numToStr(perImage) },
      issues: UNPRICED_NONE
    };
  }

  const inputRate = pricing.input;
  const imageInputRate = pricing.imageInput ?? pricing.input;
  const imageOutputRate = pricing.imageOutput ?? pricing.output;
  const outputRate = pricing.output ?? pricing.imageOutput;
  const inputTokens = args.inputTokens ?? 0;
  const outputTokens = args.outputTokens ?? 0;
  // A provider's count of pictures is never more than its count in all; held
  // to it all the same, so the words never come out below none.
  const imageInputTokens = Math.min(args.imageInputTokens ?? 0, inputTokens);
  const imageOutputTokens = Math.min(args.imageOutputTokens ?? 0, outputTokens);
  const cost = roundCost(
    ((inputTokens - imageInputTokens) * toNum(inputRate) +
      imageInputTokens * toNum(imageInputRate) +
      (outputTokens - imageOutputTokens) * toNum(outputRate) +
      imageOutputTokens * toNum(imageOutputRate)) /
      1_000_000
  );
  return {
    cost,
    snapshot: {
      ...EMPTY_SNAPSHOT,
      inputPrice: numToStr(inputRate),
      outputPrice: numToStr(outputRate),
      imageInputPrice: numToStr(imageInputRate),
      imageOutputPrice: numToStr(imageOutputRate)
    },
    // A model that counts no tokens cannot be priced by them.
    issues:
      inputTokens + outputTokens === 0
        ? { unsupported: modeName('image', 'tokens'), unpriced: [] }
        : {
            unpriced: unpricedOf([
              ['Input', inputTokens - imageInputTokens, inputRate],
              ['Image input', imageInputTokens, imageInputRate],
              ['Output', outputTokens - imageOutputTokens, outputRate],
              ['Image output', imageOutputTokens, imageOutputRate]
            ])
          }
  };
}

/**
 * Cost for a video generation call. Four mutually-exclusive billing styles,
 * per-video wins (mirrors calculateImageCost / calculateAudioCost):
 *   - per-video (flat per clip): Kling, Sora-base → videoCount × video
 *   - per-token:                 Gemini Omni, Seedance → the video's tokens
 *     at videoTokens, any read at input, and any words written or thought
 *     at output, per 1M
 *   - per-second (duration):     Sora, Veo, Runway → videoSeconds × videoSeconds
 *   - per resolution:            xAI → videoSeconds × the rate of the
 *     resolution it was made at, or the highest set where it has none or
 *     none was sent (see `resolutionRate`)
 * Every real video model picks ONE basis (no provider charges a flat fee AND
 * per second). Checking per-video first avoids double-charging on misconfig.
 * A per-video rate of 0 is set, and bills each video at nothing.
 */
export function calculateVideoCost(
  args: {
    videoCount?: number;
    videoSeconds?: number;
    videoTokens?: number;
    /** What the provider read, wrote and thought to make it, where it
     *  counts those apart. */
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    /** The resolution sent. */
    resolution?: string;
  },
  pricing: PricingRecord | null
): Billed {
  if (!pricing) {
    return { cost: 0, snapshot: { ...EMPTY_SNAPSHOT }, issues: UNPRICED_NONE };
  }

  if (pricing.video != null) {
    return {
      cost: roundCost((args.videoCount ?? 0) * toNum(pricing.video)),
      snapshot: { ...EMPTY_SNAPSHOT, videoPrice: numToStr(pricing.video) },
      issues: UNPRICED_NONE
    };
  }

  if (pricing.videoTokens != null) {
    const videoTokens = args.videoTokens ?? 0;
    return {
      cost: roundCost(
        ((args.inputTokens ?? 0) * toNum(pricing.input) +
          ((args.outputTokens ?? 0) + (args.reasoningTokens ?? 0)) *
            toNum(pricing.output) +
          (args.videoTokens ?? 0) * toNum(pricing.videoTokens)) /
          1_000_000
      ),
      snapshot: {
        ...EMPTY_SNAPSHOT,
        inputPrice: numToStr(pricing.input),
        outputPrice: numToStr(pricing.output),
        reasoningPrice: numToStr(pricing.output),
        videoTokensPrice: numToStr(pricing.videoTokens)
      },
      // A model that counts no tokens for its video cannot be priced by them.
      issues:
        videoTokens === 0
          ? { unsupported: modeName('video', 'tokens'), unpriced: [] }
          : {
              unpriced: unpricedOf([
                ['Input', args.inputTokens ?? 0, pricing.input],
                [
                  'Output',
                  (args.outputTokens ?? 0) + (args.reasoningTokens ?? 0),
                  pricing.output
                ]
              ])
            }
    };
  }

  const byResolution = pricedByResolution(pricing);
  const perSecond = byResolution
    ? resolutionRate(pricing, args.resolution)
    : pricing.videoSeconds;
  return {
    cost: roundCost((args.videoSeconds ?? 0) * toNum(perSecond)),
    snapshot: { ...EMPTY_SNAPSHOT, videoSecondsPrice: numToStr(perSecond) },
    // A length is always to be had; one not found cannot be priced by it.
    issues:
      (args.videoSeconds ?? 0) === 0
        ? {
            unsupported: modeName(
              'video',
              byResolution ? 'resolution' : 'seconds'
            ),
            unpriced: []
          }
        : UNPRICED_NONE
  };
}

/** The tokens an audio call took: the words and the audio, read and written. */
type AudioTokens = {
  inputTokens?: number;
  outputTokens?: number;
  audioInputTokens?: number;
  audioOutputTokens?: number;
};

/** An audio call priced per token: each kind at its rate, per million. */
function audioTokenCost(
  kind: 'speech' | 'transcription',
  tokens: AudioTokens,
  pricing: PricingRecord
): Billed {
  const used: Array<[string, number, string | null]> = [
    ['Input', tokens.inputTokens ?? 0, pricing.input],
    ['Output', tokens.outputTokens ?? 0, pricing.output],
    ['Audio input', tokens.audioInputTokens ?? 0, pricing.audioInput],
    ['Audio output', tokens.audioOutputTokens ?? 0, pricing.audioOutput]
  ];
  return {
    cost: roundCost(
      ((tokens.inputTokens ?? 0) * toNum(pricing.input) +
        (tokens.outputTokens ?? 0) * toNum(pricing.output) +
        (tokens.audioInputTokens ?? 0) * toNum(pricing.audioInput) +
        (tokens.audioOutputTokens ?? 0) * toNum(pricing.audioOutput)) /
        1_000_000
    ),
    snapshot: {
      ...EMPTY_SNAPSHOT,
      inputPrice: numToStr(pricing.input),
      outputPrice: numToStr(pricing.output),
      audioInputPrice: numToStr(pricing.audioInput),
      audioOutputPrice: numToStr(pricing.audioOutput)
    },
    // A model that counts no tokens cannot be priced by them.
    issues: used.every(([, count]) => count === 0)
      ? { unsupported: modeName(kind, 'tokens'), unpriced: [] }
      : { unpriced: unpricedOf(used) }
  };
}

/**
 * Cost for a speech (TTS) call: characters × the per-1M-character rate, or,
 * for a model priced per token, the words read and the audio spoken each at
 * its rate — counted by the providers that say (see `speechTokens`).
 */
export function calculateAudioCost(
  args: { audioCharacters?: number } & AudioTokens,
  pricing: PricingRecord | null
): Billed {
  if (!pricing) {
    return { cost: 0, snapshot: { ...EMPTY_SNAPSHOT }, issues: UNPRICED_NONE };
  }
  if (pricing.audioCharacters == null) {
    return audioTokenCost('speech', args, pricing);
  }

  // Characters are counted from the text read, which is never empty.
  return {
    cost: roundCost(
      ((args.audioCharacters ?? 0) * toNum(pricing.audioCharacters)) / 1_000_000
    ),
    snapshot: {
      ...EMPTY_SNAPSHOT,
      audioCharactersPrice: numToStr(pricing.audioCharacters)
    },
    issues: UNPRICED_NONE
  };
}

/**
 * Cost for a transcription (STT) call: the minutes heard × the rate per
 * minute, the audio's length being reported in seconds — or, for a model
 * priced per token, the audio heard and the words written each at its rate.
 */
export function calculateTranscriptionCost(
  args: { audioSeconds?: number } & AudioTokens,
  pricing: PricingRecord | null
): Billed {
  if (!pricing) {
    return { cost: 0, snapshot: { ...EMPTY_SNAPSHOT }, issues: UNPRICED_NONE };
  }
  if (pricing.audioMinute == null) {
    return audioTokenCost('transcription', args, pricing);
  }

  const perMinute = toNum(pricing.audioMinute);
  return {
    cost: roundCost(((args.audioSeconds ?? 0) / 60) * perMinute),
    snapshot: {
      ...EMPTY_SNAPSHOT,
      audioMinutePrice: numToStr(pricing.audioMinute)
    },
    // A length is always to be had; one not found cannot be priced by it.
    issues:
      (args.audioSeconds ?? 0) === 0
        ? { unsupported: modeName('transcription', 'minute'), unpriced: [] }
        : UNPRICED_NONE
  };
}

const roundCost = (n: number) =>
  Math.round(n * 10_000_000_000) / 10_000_000_000;

// ============================================================================
// Admin CRUD
// ============================================================================

/** Models bound to a provider the condition matches — see the note on the
 *  twin of this in `services/model.ts`. */
function boundTo(condition: SQL | undefined) {
  return inArray(
    models.modelId,
    db
      .select({ modelId: modelProviders.modelId })
      .from(modelProviders)
      .innerJoin(providers, eq(providers.id, modelProviders.providerId))
      .where(condition)
  );
}

/** Every model with its pricing row — the admin pricing table. */
export async function listPricingWithModels(
  filter: z.infer<typeof pricingListSchema>
) {
  const search = filter.q?.trim();
  const term = search ? `%${search}%` : null;
  // A price is a row of its own, so having one is being named by that table.
  const pricedModelIds = db
    .select({ modelId: modelPricings.modelId })
    .from(modelPricings);
  const where = and(
    filter.capability ? eq(models.capability, filter.capability) : undefined,
    filter.priced === 'priced'
      ? inArray(models.modelId, pricedModelIds)
      : filter.priced === 'unpriced'
        ? notInArray(models.modelId, pricedModelIds)
        : undefined,
    term
      ? or(
          ilike(models.name, term),
          ilike(models.modelId, term),
          // A relational `where` cannot reach across `model_provider`, so the
          // matching providers name the models instead.
          boundTo(ilike(providers.name, term))
        )
      : undefined,
    filter.providerId ? boundTo(eq(providers.id, filter.providerId)) : undefined
  );

  const [result, [totalRow]] = await Promise.all([
    db.query.models.findMany({
      where,
      ...pageWindow(filter),
      with: {
        providers: {
          with: { provider: true },
          orderBy: (b, { asc }) => [asc(b.priority)]
        },
        pricings: { limit: 1 }
      },
      // `id` last so the order is total, which offset paging depends on.
      orderBy: (m, { asc, desc }) => [
        asc(m.displayOrder),
        desc(m.createdAt),
        asc(m.id)
      ]
    }),
    db.select({ count: count() }).from(models).where(where)
  ]);

  return {
    rows: result.map(m => ({ ...m, pricing: m.pricings[0] ?? null })),
    total: Number(totalRow?.count ?? 0),
    page: filter.page,
    pageSize: filter.pageSize
  };
}

/** The rates that decide which way a model bills. */
type BillingStyles = Partial<
  Record<
    | 'input'
    | 'output'
    | 'image'
    | 'imageInput'
    | 'imageOutput'
    | 'video'
    | 'videoSeconds'
    | 'videoTokens'
    | 'audioCharacters'
    | 'audioInput'
    | 'audioOutput'
    | 'audioMinute',
    unknown
  >
> & { resolutionPrices?: Record<string, string> | null };

/**
 * Why a set of rates cannot be billed from, or null when it can.
 *
 * Each capability bills in exactly one style, and a row priced in two has no
 * defined cost — the cost engine picks one and the other is silently ignored.
 * Shared by the console form and the price sync, since either can write a row.
 */
export function pricingStyleConflict(
  capability: 'chat' | 'image' | 'video' | 'audio',
  p: BillingStyles
): string | null {
  // Image models bill per-image, per resolution OR per-token, only one —
  // the styles are mutually exclusive (see calculateImageCost).
  const byResolution = pricedByResolution(p);
  const imageStyles = [
    p.image != null,
    byResolution,
    p.input != null ||
      p.output != null ||
      p.imageInput != null ||
      p.imageOutput != null
  ].filter(Boolean).length;
  if (capability === 'image' && imageStyles > 1) {
    return 'Image pricing must be exactly one style: Per image, Per resolution, or token-based (Input + Image output).';
  }

  // Audio is one-of-three: per-character (classic TTS), per-token — the
  // words and the audio — or per-minute (STT).
  const audioStyles = [
    p.audioCharacters != null,
    p.input != null ||
      p.output != null ||
      p.audioInput != null ||
      p.audioOutput != null,
    p.audioMinute != null
  ].filter(Boolean).length;
  if (capability === 'audio' && audioStyles > 1) {
    return 'Audio pricing must be exactly one style: Per 1M characters, token-based (Input / Output, Audio input / Audio output), or Per minute.';
  }

  // Video is the same one-of: per-video (flat), per-second, per resolution
  // or per-token — the video's tokens, and any it read, wrote or thought.
  const videoStyles = [
    p.video != null,
    p.videoSeconds != null,
    byResolution,
    (p.videoTokens ?? p.input ?? p.output) != null
  ].filter(Boolean).length;
  if (capability === 'video' && videoStyles > 1) {
    return 'Video pricing must be exactly one style: Per video, Per second, Per resolution, or per token (Input, Output, Video output).';
  }

  return null;
}

/**
 * Create or replace a model's pricing. One row per model.
 *
 * Each capability bills in exactly one style, and the checks below reject a
 * combination the cost engine could not resolve — an image model priced both
 * per-image and per-token has no defined cost.
 */
/** One model and its price as the console edits them — a row of the pricing
 *  table, read at the moment the form opens. */
export async function getModelPricing(modelDbId: string) {
  const model = await db.query.models.findFirst({
    where: eq(models.id, modelDbId),
    with: {
      providers: {
        with: { provider: true },
        orderBy: (b, { asc }) => [asc(b.priority)]
      },
      pricings: { limit: 1 }
    }
  });
  if (!model) return undefined;

  return { ...model, pricing: model.pricings[0] ?? null };
}

export async function upsertPricing(form: z.infer<typeof pricingUpsertSchema>) {
  const model = await db.query.models.findFirst({
    where: eq(models.id, form.modelDbId)
  });
  if (!model) throw new PublicError('Model not found');

  // Capability-aware required-field check. Reuses `pricingMissingFields`
  // from lib/pricing so admin-side and runtime gate share the same rule.
  const cap = model.capability;
  // A rate a model of its kind does not carry is not kept, whatever sent it.
  const data = {
    ...form,
    ...strayRatesOf(cap, !!model.supportsTranscription)
  };

  const conflict = pricingStyleConflict(cap, data);
  if (conflict) throw new PublicError(conflict);

  const missing = pricingMissingFields(
    cap,
    data as unknown as PricingRecord,
    cap === 'audio'
      ? { transcription: !!model.supportsTranscription }
      : undefined
  );
  if (missing.length > 0) {
    throw new PublicError(
      `Missing required price${missing.length > 1 ? 's' : ''} for ${cap} model: ${missing.join(', ')}.`
    );
  }

  const now = new Date();
  // A rate not set stays null: what it bills is the cost engine's to say.
  const values = {
    modelId: model.modelId,
    input: data.input,
    output: data.output,
    cacheRead: data.cacheRead,
    cacheWrite: data.cacheWrite,
    // Reasoning stays null when not set — cost engine falls back to output.
    reasoning: data.reasoning,
    webSearch: data.webSearch,
    xPost: data.xPost,
    xProfile: data.xProfile,
    image: data.image,
    imageInput: data.imageInput,
    imageOutput: data.imageOutput,
    video: data.video,
    videoSeconds: data.videoSeconds,
    videoTokens: data.videoTokens,
    resolutionPrices: data.resolutionPrices,
    audioInput: data.audioInput,
    audioOutput: data.audioOutput,
    audioCharacters: data.audioCharacters,
    audioMinute: data.audioMinute,
    source: data.source,
    updatedAt: now
  };

  const existing = await db.query.modelPricings.findFirst({
    where: eq(modelPricings.modelId, model.modelId)
  });
  if (existing) {
    await db
      .update(modelPricings)
      .set(values)
      .where(eq(modelPricings.id, existing.id));
  } else {
    await db.insert(modelPricings).values({
      id: generateUUID(),
      ...values,
      createdAt: now
    });
  }
}

export async function deletePricing(id: string) {
  await db.delete(modelPricings).where(eq(modelPricings.id, id));
}
