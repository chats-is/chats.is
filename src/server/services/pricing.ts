import '@tanstack/react-start/server-only';

import { cache } from 'react';
import { and, eq } from 'drizzle-orm';
import { type z } from 'zod';

import {
  type ChatUsage,
  type PriceSnapshot,
  type PricingRecord
} from '@/types';
import {
  type pricingListSchema,
  type pricingUpsertSchema
} from '@/types/pricing';
import { generateUUID, parseNumber } from '@/lib/utils';
import { db } from '@/db';
import { modelPricings, models } from '@/db/schema';
import { PublicError } from '@/server/public-error';

const EMPTY_SNAPSHOT: PriceSnapshot = {
  inputPrice: null,
  outputPrice: null,
  cacheReadPrice: null,
  cacheWritePrice: null,
  reasoningPrice: null,
  imagePrice: null,
  videoPrice: null,
  videoSecondsPrice: null,
  audioInputPrice: null,
  audioOutputPrice: null,
  audioCharactersPrice: null,
  audioSecondsPrice: null
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
 * in `server/api/routers/pricing.ts`. Cache R/W are not required (default 0).
 *
 *   chat   → Input + Output (both must be set).
 *   image  → Image (per item) OR token-based (Input + Output), e.g.
 *            gpt-image-1 bills per token while DALL-E bills per image.
 *   video  → Either Per video OR Per second.
 *   audio  → direction-aware: TTS bills per character or per token; STT
 *            (opts.transcription) bills per second. Without the direction
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
      return set(p.image) || (set(p.input) && set(p.output))
        ? []
        : ['Image, or Input + Output'];
    case 'video':
      return set(p.video) || set(p.videoSeconds)
        ? []
        : ['Per video / Per second'];
    case 'audio': {
      // STT bills per second; TTS bills per character or per token. The
      // billed dimension must match the model's direction — a mismatched
      // style would pass the gate but compute $0 cost.
      if (opts?.transcription === true) {
        return set(p.audioSeconds) ? [] : ['Per second'];
      }
      if (opts?.transcription === false) {
        return set(p.audioCharacters) ? [] : ['Per 1M characters'];
      }
      return set(p.audioCharacters) || set(p.audioSeconds)
        ? []
        : ['Per 1M characters, Audio input / Audio output, or Per second'];
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
 * Calculate the cost of a chat completion in USD.
 *
 * `usage` MUST be the normalized, mutually-exclusive buckets produced by
 * `normalizeChatUsage` (lib/chat-usage.ts) — `inputTokens` is plain (uncached)
 * input and `outputTokens` is text-only (reasoning excluded). Because the
 * buckets are disjoint, cost is plain per-dimension multiplication with no
 * subtraction, so the cached/reasoning portions can never be double-billed.
 *
 * Token counts are absolute (not per-million).
 *   - Cache R/W: billed strictly at their configured rate. Default to 0 at
 *     write-time (see pricing router / sync), so an unconfigured cache rate
 *     means "free" — snapshot stays consistent with the rate used.
 *   - Reasoning: billed at `pricing.reasoning` when set; otherwise falls back
 *     to `pricing.output` (the convention for OpenAI o-series, Anthropic
 *     thinking, Google, DeepSeek). Qwen-style models with a distinct rate
 *     should set `pricing.reasoning` explicitly. Snapshot records the rate
 *     actually used so each usage row is self-auditable.
 */
export function calculateChatCost(
  usage: ChatUsage,
  pricing: PricingRecord | null
): { cost: number; snapshot: PriceSnapshot } {
  if (!pricing) return { cost: 0, snapshot: { ...EMPTY_SNAPSHOT } };

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

  const cost =
    (inputTokens * inputRate) / 1_000_000 +
    (cacheReadTokens * cacheReadRate) / 1_000_000 +
    (cacheWriteTokens * cacheWriteRate) / 1_000_000 +
    (outputTokens * outputRate) / 1_000_000 +
    (reasoningTokens * reasoningRate) / 1_000_000;

  return {
    cost: roundCost(cost),
    snapshot: {
      ...EMPTY_SNAPSHOT,
      inputPrice: numToStr(pricing.input),
      outputPrice: numToStr(pricing.output),
      cacheReadPrice: numToStr(pricing.cacheRead),
      cacheWritePrice: numToStr(pricing.cacheWrite),
      reasoningPrice: numToStr(reasoningRateStr)
    }
  };
}

/**
 * Cost for an image generation call.
 */
export function calculateImageCost(
  args: {
    imageCount: number;
    inputTokens?: number;
    outputTokens?: number;
  },
  pricing: PricingRecord | null
): { cost: number; snapshot: PriceSnapshot } {
  if (!pricing) return { cost: 0, snapshot: { ...EMPTY_SNAPSHOT } };

  const perImage = toNum(pricing.image);

  // Two mutually-exclusive billing styles, image-price wins:
  //   - per-image  (DALL-E / imagen): imageCount × image
  //   - per-token  (gpt-image-1 ...): inputTokens × input + outputTokens × output
  // A model only ever configures one. Checking per-image first avoids
  // double-charging if both happen to be set (misconfig / dirty sync).
  if (perImage > 0) {
    return {
      cost: roundCost(args.imageCount * perImage),
      snapshot: { ...EMPTY_SNAPSHOT, imagePrice: numToStr(pricing.image) }
    };
  }

  const inputRate = toNum(pricing.input);
  const outputRate = toNum(pricing.output);
  const inputTokens = args.inputTokens ?? 0;
  const outputTokens = args.outputTokens ?? 0;
  const cost = roundCost(
    (inputTokens * inputRate) / 1_000_000 +
      (outputTokens * outputRate) / 1_000_000
  );
  return {
    cost,
    snapshot: {
      ...EMPTY_SNAPSHOT,
      inputPrice: numToStr(pricing.input),
      outputPrice: numToStr(pricing.output)
    }
  };
}

/**
 * Cost for a video generation call. Two mutually-exclusive billing styles,
 * per-video wins (mirrors calculateImageCost / calculateAudioCost):
 *   - per-video (flat per clip): Kling, Sora-base → videoCount × video
 *   - per-second (duration):     Sora, Veo, Runway → videoSeconds × videoSeconds
 * Every real video model picks ONE basis (no provider charges a flat fee AND
 * per second). Checking per-video first avoids double-charging on misconfig.
 */
export function calculateVideoCost(
  args: { videoCount?: number; videoSeconds?: number },
  pricing: PricingRecord | null
): { cost: number; snapshot: PriceSnapshot } {
  if (!pricing) return { cost: 0, snapshot: { ...EMPTY_SNAPSHOT } };

  const perVideo = toNum(pricing.video);
  if (perVideo > 0) {
    return {
      cost: roundCost((args.videoCount ?? 0) * perVideo),
      snapshot: { ...EMPTY_SNAPSHOT, videoPrice: numToStr(pricing.video) }
    };
  }

  const perSecond = toNum(pricing.videoSeconds);
  return {
    cost: roundCost((args.videoSeconds ?? 0) * perSecond),
    snapshot: {
      ...EMPTY_SNAPSHOT,
      videoSecondsPrice: numToStr(pricing.videoSeconds)
    }
  };
}

/**
 * Cost for a speech (TTS) call: characters × the per-1M-character rate.
 *
 * Characters are what speech generation measures — `generateSpeech` returns
 * no usage, so no provider's token counts reach us. A token rate was once
 * accepted here and always multiplied by zero.
 */
export function calculateAudioCost(
  args: { audioCharacters?: number },
  pricing: PricingRecord | null
): { cost: number; snapshot: PriceSnapshot } {
  if (!pricing) return { cost: 0, snapshot: { ...EMPTY_SNAPSHOT } };

  return {
    cost: roundCost(
      ((args.audioCharacters ?? 0) * toNum(pricing.audioCharacters)) / 1_000_000
    ),
    snapshot: {
      ...EMPTY_SNAPSHOT,
      audioCharactersPrice: numToStr(pricing.audioCharacters)
    }
  };
}

/**
 * Cost for a transcription (STT) call: audioSeconds × per-second rate.
 */
export function calculateTranscriptionCost(
  args: { audioSeconds?: number },
  pricing: PricingRecord | null
): { cost: number; snapshot: PriceSnapshot } {
  if (!pricing) return { cost: 0, snapshot: { ...EMPTY_SNAPSHOT } };

  const perSecond = toNum(pricing.audioSeconds);
  return {
    cost: roundCost((args.audioSeconds ?? 0) * perSecond),
    snapshot: {
      ...EMPTY_SNAPSHOT,
      audioSecondsPrice: numToStr(pricing.audioSeconds)
    }
  };
}

const roundCost = (n: number) =>
  Math.round(n * 10_000_000_000) / 10_000_000_000;

// ============================================================================
// Admin CRUD
// ============================================================================

/** Every model with its pricing row — the admin pricing table. */
export async function listPricingWithModels(
  filter: z.infer<typeof pricingListSchema>
) {
  const result = await db.query.models.findMany({
    where: and(
      filter.capability ? eq(models.capability, filter.capability) : undefined,
      filter.providerId ? eq(models.providerId, filter.providerId) : undefined
    ),
    with: {
      provider: true,
      pricings: { limit: 1 }
    },
    orderBy: (m, { asc, desc }) => [asc(m.displayOrder), desc(m.createdAt)]
  });
  return result.map(m => ({
    ...m,
    pricing: m.pricings[0] ?? null
  }));
}

/**
 * Create or replace a model's pricing. One row per model.
 *
 * Each capability bills in exactly one style, and the checks below reject a
 * combination the cost engine could not resolve — an image model priced both
 * per-image and per-token has no defined cost.
 */
export async function upsertPricing(data: z.infer<typeof pricingUpsertSchema>) {
  const model = await db.query.models.findFirst({
    where: eq(models.id, data.modelDbId)
  });
  if (!model) throw new PublicError('Model not found');

  // Capability-aware required-field check. Cache R/W are auto-defaulted
  // to 0 below, so they don't need to be in the required list. Reuses
  // `pricingMissingFields` from lib/pricing so admin-side and runtime
  // gate share the same rule.
  const cap = model.capability;

  // Image models bill EITHER per-image OR per-token, never both — the two
  // styles are mutually exclusive (see calculateImageCost).
  if (
    cap === 'image' &&
    data.image != null &&
    (data.input != null || data.output != null)
  ) {
    throw new PublicError(
      'Image pricing must be either Per image OR token-based (Input + Output), not both.'
    );
  }

  // Audio is one-of-three: per-character (classic TTS), per-token, or
  // per-second (STT).
  const audioStyles = [
    data.audioCharacters != null,
    data.audioInput != null || data.audioOutput != null,
    data.audioSeconds != null
  ].filter(Boolean).length;
  if (cap === 'audio' && audioStyles > 1) {
    throw new PublicError(
      'Audio pricing must be exactly one style: Per 1M characters, token-based (Audio data / output), or Per second.'
    );
  }

  // Video is the same either/or: per-video (flat) OR per-second.
  if (cap === 'video' && data.video != null && data.videoSeconds != null) {
    throw new PublicError(
      'Video pricing must be either Per video OR Per second, not both.'
    );
  }

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
  // Cache R/W default to "0" (free) when not set, so the cost engine
  // never falls back to data rate. All other fields stay null when unset.
  const cacheDefault = (v: string | null | undefined): string =>
    v === null || v === undefined || v === '' ? '0' : v;
  const values = {
    modelId: model.modelId,
    input: data.input,
    output: data.output,
    cacheRead: cacheDefault(data.cacheRead),
    cacheWrite: cacheDefault(data.cacheWrite),
    // Reasoning stays null when not set — cost engine falls back to output.
    reasoning: data.reasoning,
    image: data.image,
    video: data.video,
    videoSeconds: data.videoSeconds,
    audioInput: data.audioInput,
    audioOutput: data.audioOutput,
    audioCharacters: data.audioCharacters,
    audioSeconds: data.audioSeconds,
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
