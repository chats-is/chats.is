import { type ChatUsage } from '@/types';
import {
  GEMINI_WEB_SEARCH_TOOL_NAME,
  PROVIDER_WEB_SEARCH_TOOL_NAMES
} from '@/lib/constant';

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

/**
 * A turn's usage, as the sum of what each of its steps reported.
 *
 * The SDK offers a total of its own at the end of a turn, but only a turn that
 * ended well has one: when a later step fails, the total comes back empty and
 * the steps before it — answered, and paid for — count for nothing. The buckets
 * are disjoint and additive, so adding the steps up is exact.
 */
export function sumChatUsage(steps: ChatUsage[]): ChatUsage {
  const total: Required<ChatUsage> = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    webSearches: 0
  };

  for (const step of steps) {
    total.inputTokens += step.inputTokens ?? 0;
    total.outputTokens += step.outputTokens ?? 0;
    total.cacheReadTokens += step.cacheReadTokens ?? 0;
    total.cacheWriteTokens += step.cacheWriteTokens ?? 0;
    total.reasoningTokens += step.reasoningTokens ?? 0;
    total.webSearches += step.webSearches ?? 0;
  }

  return total;
}

/**
 * The shape of a finished step that the count below reads: what the model
 * produced, and what the provider said beside it.
 */
export type SearchStepLike = {
  content?: ReadonlyArray<{
    type: string;
    toolName?: string;
    providerExecuted?: boolean;
    input?: unknown;
  }>;
  providerMetadata?: Record<string, unknown> | undefined;
};

/**
 * How many web searches a step made, as the provider bills them.
 *
 * OpenAI, Anthropic and xAI run their search as a tool call the step reports,
 * and charge each one. Gemini charges each query it sends Google, and one
 * search may send several. Where it reports its searches — beside function
 * tools, through Google's own API — their queries are counted; elsewhere
 * (Vertex, or the search tool alone) the queries its grounding lists. That
 * list can miss one when the model searches twice in a step, so the searches
 * reported come first.
 */
export function countWebSearches(step: SearchStepLike): number {
  const content = step.content ?? [];
  const calls = content.filter(
    part =>
      part.type === 'tool-call' &&
      part.providerExecuted === true &&
      !!part.toolName &&
      PROVIDER_WEB_SEARCH_TOOL_NAMES.includes(part.toolName)
  ).length;

  const reported = content
    .filter(
      part =>
        part.type === 'tool-call' &&
        part.toolName === GEMINI_WEB_SEARCH_TOOL_NAME
    )
    // A search with no queries to show still went to Google once.
    .reduce((sum, part) => sum + Math.max(1, queriesIn(part.input)), 0);
  const google = step.providerMetadata?.google as
    | { groundingMetadata?: { webSearchQueries?: string[] | null } | null }
    | undefined;
  const listed = google?.groundingMetadata?.webSearchQueries?.length ?? 0;

  return calls + (reported || listed);
}

/** How many queries a search Gemini reported ran. */
function queriesIn(input: unknown): number {
  const queries = (input as { queries?: unknown } | null)?.queries;
  return Array.isArray(queries) ? queries.length : 0;
}
