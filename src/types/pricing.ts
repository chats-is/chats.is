import type { modelPricings } from '@/server/db/schema'

/** A row in `model_pricing`. Inferred from the Drizzle schema. */
export type PricingRecord = typeof modelPricings.$inferSelect

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
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** Subset of `model_pricing` rates this call actually used, snapshotted at
 *  cost-compute time. Each field is the per-unit USD rate (or null when the
 *  dimension didn't apply to the capability). */
export type PriceSnapshot = {
  inputPrice: string | null
  outputPrice: string | null
  cacheReadPrice: string | null
  cacheWritePrice: string | null
  /** The rate actually charged for reasoning tokens — may differ from
   *  `pricing.reasoning` when fallback kicked in (defaults to output rate). */
  reasoningPrice: string | null
  imagePrice: string | null
  videoPrice: string | null
  videoSecondsPrice: string | null
  audioInputPrice: string | null
  audioOutputPrice: string | null
  audioCharactersPrice: string | null
  audioSecondsPrice: string | null
}

/** Recognized external pricing data sources. */
export type PricingSource = 'models.dev' | 'llm-metadata'

/** Aggregated outcome of a `syncPricing` run. */
export type PricingSyncResult = {
  matched: number
  updated: number
  created: number
  unchanged: number
  /** modelIds in our DB that the remote source had no entry for. */
  notFound: string[]
}
