import { z } from 'zod';

import { PRICING_MODES } from '@/lib/constant';
import { type modelPricings } from '@/db/schema';

import { modelCapabilitySchema, type ModelCapability } from './model';
import { paginationSchema } from './pagination';

/** A row in `model_pricing`. Inferred from the Drizzle schema. */
export type PricingRecord = typeof modelPricings.$inferSelect;

/** Normalized, mutually-exclusive token buckets the chat path passes to
 *  `calculateChatCost`. Unlike the raw AI SDK usage (overlapping totals),
 *  these are disjoint and additive — `normalizeChatUsage` (lib/chat-usage.ts)
 *  subtracts the cached/reasoning sub-counts from their totals at the SDK
 *  boundary, so each field is billed independently with no double-counting:
 *    inputTokens  = plain (uncached) input
 *    outputTokens = text output (reasoning excluded)
 *
 *  Field names match the `usage` table's columns, so the mapping in
 *  `recordChatUsage` is one-to-one. They deliberately do NOT mirror the SDK's:
 *  `RawChatUsage` (lib/chat-usage.ts) is the type that models what the SDK
 *  hands over, and keeping the two vocabularies apart is what makes it obvious
 *  which side of the boundary a given field belongs to. */
export type ChatUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  /** Web searches the call made, billed at the model's search rate, which is
   *  per thousand. */
  webSearches?: number;
  /** What its searches of X fetched — posts, and profiles — each billed at
   *  its own rate per thousand, as xAI bills them. */
  xPosts?: number;
  xProfiles?: number;
};

/** Subset of `model_pricing` rates this call actually used, snapshotted at
 *  cost-compute time. Each field is the per-unit USD rate (or null when the
 *  dimension didn't apply to the capability). */
export type PriceSnapshot = {
  inputPrice: string | null;
  outputPrice: string | null;
  cacheReadPrice: string | null;
  cacheWritePrice: string | null;
  /** The rate actually charged for reasoning tokens — may differ from
   *  `pricing.reasoning` when fallback kicked in (defaults to output rate). */
  reasoningPrice: string | null;
  webSearchPrice: string | null;
  xPostPrice: string | null;
  xProfilePrice: string | null;
  imagePrice: string | null;
  /** The rates charged for the pictures an image model read and drew — each
   *  as used, after falling back to `input` or `output`. */
  imageInputPrice: string | null;
  imageOutputPrice: string | null;
  videoPrice: string | null;
  /** The rate per second it was billed at: priced per second, that rate;
   *  per resolution, its resolution's, or the highest where it had none. As
   *  `imagePrice` is per image. */
  videoSecondsPrice: string | null;
  videoTokensPrice: string | null;
  audioInputPrice: string | null;
  audioOutputPrice: string | null;
  audioCharactersPrice: string | null;
  /** Per minute of audio heard, as a transcription model is priced. */
  audioMinutePrice: string | null;
};

/** Recognized external pricing data sources. */
export type PricingSource = 'models.dev' | 'llm-metadata';

/** A rate a model's price carries, by its name in the pricing row. */
export type PricingRate = Exclude<
  keyof z.infer<typeof pricingUpsertSchema>,
  'modelDbId' | 'resolutionPrices' | 'source'
>;

/** A way a model is priced, and the rates it reads. */
export type PricingMode = {
  value: string;
  label: string;
  rates: PricingRate[];
  /** Priced by a rate for each resolution, in `resolutionPrices`. */
  byResolution?: boolean;
};

/** The kinds of model with ways of pricing of their own — an audio model by
 *  its direction. */
export type PricingKind = 'image' | 'video' | 'speech' | 'transcription';

/** The ways a model can be priced, one of which it is: none for a chat
 *  model, whose rates all add up. */
export function pricingModesOf(
  capability: ModelCapability,
  transcription: boolean
): PricingMode[] {
  if (capability === 'chat') return [];
  return PRICING_MODES[
    capability === 'audio'
      ? transcription
        ? 'transcription'
        : 'speech'
      : capability
  ];
}

/** Aggregated outcome of a `syncPricing` run. */
export type PricingSyncResult = {
  matched: number;
  updated: number;
  created: number;
  unchanged: number;
  /** modelIds in our DB that the remote source had no entry for. */
  notFound: string[];
  /** Models left as they were, because what the source offered would have
   *  stopped them working — and why. */
  skipped: Array<{ modelId: string; reason: string }>;
};

const pricingSourceSchema = z.enum(['manual', 'models.dev', 'llm-metadata']);
const pricingSyncSourceSchema = z.enum(['models.dev', 'llm-metadata']);

/**
 * A price as the admin form supplies it — a number, a string, or blank —
 * normalised to what the column stores: a decimal string, or null when it is
 * blank or unusable. Doing it here means every caller and the row itself see
 * one representation.
 */
const priceNumberSchema = z
  .union([z.number(), z.string()])
  .optional()
  .nullable()
  .transform(v => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return n.toString();
  });

/** A rate for each size or resolution, as the form supplies them: blanks
 *  dropped, and none at all stored as null. */
const resolutionPricesSchema = z
  .record(z.string(), priceNumberSchema)
  .optional()
  .nullable()
  .transform(prices => {
    const set = Object.entries(prices ?? {}).filter(
      (entry): entry is [string, string] => entry[1] !== null
    );
    return set.length > 0 ? Object.fromEntries(set) : null;
  });

/** What the pricing server functions accept. The console's pricing table is
 *  narrowed, then cut to one page. */
export const pricingListSchema = z.object({
  capability: modelCapabilitySchema.optional(),
  /** Only the models with a price, or only those without one. */
  priced: z.enum(['priced', 'unpriced']).optional(),
  /** Matches a model's name, its model id, or its provider's name. */
  q: z.string().optional(),
  /** Only the models bound to this provider. */
  providerId: z.string().optional(),
  ...paginationSchema.shape
});

export const pricingUpsertSchema = z.object({
  modelDbId: z.string().min(1),
  input: priceNumberSchema,
  output: priceNumberSchema,
  cacheRead: priceNumberSchema,
  cacheWrite: priceNumberSchema,
  reasoning: priceNumberSchema,
  webSearch: priceNumberSchema,
  xPost: priceNumberSchema,
  xProfile: priceNumberSchema,
  image: priceNumberSchema,
  imageInput: priceNumberSchema,
  imageOutput: priceNumberSchema,
  video: priceNumberSchema,
  videoSeconds: priceNumberSchema,
  videoTokens: priceNumberSchema,
  resolutionPrices: resolutionPricesSchema,
  audioInput: priceNumberSchema,
  audioOutput: priceNumberSchema,
  audioCharacters: priceNumberSchema,
  audioMinute: priceNumberSchema,
  source: pricingSourceSchema.default('manual')
});

export const pricingIdSchema = z.object({ id: z.string().min(1) });

/** What a sync or preview run is asked to cover. */
export const syncTargetSchema = z.object({
  source: pricingSyncSourceSchema,
  modelDbIds: z.array(z.string()).optional()
});

export const syncRunSchema = syncTargetSchema.extend({
  onlyMissing: z.boolean().default(false)
});

export const remoteSearchSchema = z.object({
  source: pricingSyncSourceSchema,
  query: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50)
});
