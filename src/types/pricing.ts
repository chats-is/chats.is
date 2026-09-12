import { z } from 'zod';

import { type modelPricings } from '@/db/schema';

import { modelCapabilitySchema } from './model';

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
  imagePrice: string | null;
  videoPrice: string | null;
  videoSecondsPrice: string | null;
  audioInputPrice: string | null;
  audioOutputPrice: string | null;
  audioCharactersPrice: string | null;
  audioSecondsPrice: string | null;
};

/** Recognized external pricing data sources. */
export type PricingSource = 'models.dev' | 'llm-metadata';

/** Aggregated outcome of a `syncPricing` run. */
export type PricingSyncResult = {
  matched: number;
  updated: number;
  created: number;
  unchanged: number;
  /** modelIds in our DB that the remote source had no entry for. */
  notFound: string[];
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

/** What the pricing server functions accept. */
export const pricingListSchema = z.object({
  capability: modelCapabilitySchema.optional(),
  providerId: z.string().optional()
});

export const pricingUpsertSchema = z.object({
  modelDbId: z.string().min(1),
  input: priceNumberSchema,
  output: priceNumberSchema,
  cacheRead: priceNumberSchema,
  cacheWrite: priceNumberSchema,
  reasoning: priceNumberSchema,
  image: priceNumberSchema,
  video: priceNumberSchema,
  videoSeconds: priceNumberSchema,
  audioInput: priceNumberSchema,
  audioOutput: priceNumberSchema,
  audioCharacters: priceNumberSchema,
  audioSeconds: priceNumberSchema,
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
