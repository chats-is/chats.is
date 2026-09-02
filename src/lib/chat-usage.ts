import type { ChatUsage } from '@/types';

/**
 * The subset of the AI SDK's `LanguageModelUsage` (the `usage` object passed to
 * `onEnd`) that we bill from.
 *
 * Since AI SDK 7 that object is the usage of *every* step in the turn, not just
 * the last one — v6's `onFinish` handed over `StepResult.usage`, the final
 * step's, and put the aggregate in a separate `totalUsage`. A tool-using turn
 * therefore bills more than it did before, which is the correct amount: the
 * earlier steps' tokens were always spent, just never charged.
 *
 * The SDK already decomposes usage into disjoint buckets under `*TokenDetails`
 * (verified against the official spec, vercel/ai #9921 — "the sum of all values
 * in inputTokenDetails equals inputTokens"):
 *   inputTokenDetails  = noCacheTokens + cacheReadTokens + cacheWriteTokens
 *   outputTokenDetails = textTokens + reasoningTokens
 * `inputTokens` / `outputTokens` are the TOTALS. `cachedInputTokens` and
 * `reasoningTokens` are deprecated flat aliases (kept here only as fallback for
 * any provider/version that doesn't populate the details objects).
 */
export type RawChatUsage = {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  outputTokenDetails?: {
    textTokens?: number;
    reasoningTokens?: number;
  };
  /** @deprecated SDK alias for inputTokenDetails.cacheReadTokens — fallback only. */
  cachedInputTokens?: number;
  /** @deprecated SDK alias for outputTokenDetails.reasoningTokens — fallback only. */
  reasoningTokens?: number;
};

/**
 * Map the AI SDK's usage into the mutually-exclusive, additive token buckets we
 * bill & store.
 *
 * Reads the SDK's already-decomposed `inputTokenDetails` / `outputTokenDetails`
 * directly — these are provider-independent (so cache-write is captured for
 * Anthropic, Bedrock, and any future provider, not just Anthropic) and avoid
 * the deprecated flat `cachedInputTokens` / `reasoningTokens` fields. Falls back
 * to deriving the buckets from the totals when a details object is absent.
 *
 * Each returned field is independent; downstream cost math is plain
 * multiplication and can never double-bill the cached or reasoning portions.
 */
export function normalizeChatUsage(raw: RawChatUsage): ChatUsage {
  const inDetails = raw.inputTokenDetails;
  const outDetails = raw.outputTokenDetails;

  const cacheReadTokens =
    inDetails?.cacheReadTokens ?? raw.cachedInputTokens ?? 0;
  const cacheWriteTokens = inDetails?.cacheWriteTokens ?? 0;
  const reasoningTokens =
    outDetails?.reasoningTokens ?? raw.reasoningTokens ?? 0;

  // Plain (uncached) input: prefer the SDK's noCacheTokens; otherwise derive it
  // from the total minus the cached portions.
  const plainInput =
    inDetails?.noCacheTokens ??
    Math.max(0, (raw.inputTokens ?? 0) - cacheReadTokens - cacheWriteTokens);

  // Text output: prefer the SDK's textTokens; otherwise total minus reasoning.
  const textOutput =
    outDetails?.textTokens ??
    Math.max(0, (raw.outputTokens ?? 0) - reasoningTokens);

  return {
    inputTokens: plainInput,
    outputTokens: textOutput,
    cacheReadTokens: cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens
  };
}
