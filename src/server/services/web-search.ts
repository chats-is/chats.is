import '@tanstack/react-start/server-only';

import { generateText, isStepCount, tool, type ToolSet } from 'ai';

import {
  webSearchInputSchema,
  type Candidate,
  type Model,
  type WebSearchToolOutput
} from '@/types';
import { countWebSearches, normalizeChatUsage } from '@/lib/chat-usage';
import {
  getLanguageModel,
  getProviderWebSearchTool,
  isRetryableProviderError,
  resolveModelId,
  runWithProviderFailover
} from '@/lib/provider';
import { canSearchWeb, searchesForItself } from '@/lib/web-search';
import { preflightCheck } from '@/server/services/preflight';
import { getWebSearchSettings } from '@/server/services/settings';
import { recordChatUsage } from '@/server/services/usage';

/**
 * How many searches one reply may delegate. Each is a model call of its own,
 * and a model that keeps searching would keep paying — the ceiling holds it
 * to what a reply can reasonably need.
 */
export const MAX_WEB_SEARCHES_PER_TURN = 3;

/** How long one delegated search may take before it is given up on. */
const SEARCH_TIMEOUT_MS = 60_000;

const SEARCH_ERROR = 'The web search failed. Please try again.';

/** What the search model is told: it is a search, not a conversation. */
const SEARCH_INSTRUCTIONS = [
  'You are a web search assistant. Search the web for the query and report what you found: the facts, figures, names and dates that answer it, with the source each came from.',
  'Be concise and factual. Do not address the user, ask questions, or add opinions. Write in the language of the query.'
].join(' ');

/** The rules the chat model follows when it can search. */
export const WEB_SEARCH_GUIDANCE = [
  'You can search the web. Search when the answer depends on current events, recent releases, prices, live figures, or anything you cannot be sure of from memory; do not search for what you already know well.',
  'When your answer draws on a search, cite the pages it came from as markdown links in the text. Never mention which model or service performed the search.'
].join(' ');

/** Thrown for a provider that cannot search, so the next one is tried. */
class NoSearchError extends Error {
  constructor(provider: string) {
    super(`${provider} has no web search of its own`);
    this.name = 'NoSearchError';
  }
}

export type WebSearchSetup = {
  /**
   * The tools the chat model gets when this provider serves it: its own
   * search where the mode and model allow it, else the delegate tool — or
   * nothing, when no search model is set.
   */
  toolsFor: (candidate: Candidate) => ToolSet;
  /** The guidance for the chat model, or nothing when it cannot search. */
  systemPrompt: string;
};

/**
 * Set up web search for one reply.
 *
 * In `auto` mode a chat model with search of its own uses it — the provider
 * runs the search inside the step, and the step's usage says how many. Any
 * other model, and every model in `model` mode, gets a `web_search` tool that
 * asks the configured search model instead: one model call per search, billed
 * to that model with its search count, and returning what was found and where.
 */
export async function setupWebSearch(args: {
  userId: string;
  chatId: string;
  assistantMessageId: string;
  chatModel: Model;
  /** The providers that may serve the chat model. */
  candidates: Candidate[];
}): Promise<WebSearchSetup> {
  const { userId, chatId, assistantMessageId, chatModel, candidates } = args;
  const { mode, searchModel } = await getWebSearchSettings();
  const nothing: WebSearchSetup = { toolsFor: () => ({}), systemPrompt: '' };

  const searchable =
    searchModel && searchModel.candidates.length > 0 ? searchModel : null;
  const rule = {
    mode,
    searchModelId: searchable?.dbModel.modelId ?? null
  };

  let searches = 0;

  const delegate: ToolSet | null = searchable
    ? {
        web_search: tool({
          description:
            'Search the web and return what was found, with the pages it came from. Use for current or verifiable information.',
          inputSchema: webSearchInputSchema,
          execute: async (
            { query },
            { abortSignal }
          ): Promise<WebSearchToolOutput> => {
            // Counted before the check: the calls of one step arrive
            // together, and would all be through before any was counted.
            if (++searches > MAX_WEB_SEARCHES_PER_TURN) {
              return {
                status: 'error',
                message: `This reply has already searched ${MAX_WEB_SEARCHES_PER_TURN} times, which is the most one reply may. Answer from what was found, and tell the user more can be searched in a new message.`
              };
            }

            // Gated like any model the user uses: priced, allowed by their
            // tier, and within their quota. The operator picks the search
            // model; whether this user may use it is the tier's to say.
            const pre = await preflightCheck({
              userId,
              modelKey: searchable.dbModel.modelId,
              modelLabel: searchable.dbModel.name,
              capability: 'chat'
            });
            if (!pre.ok) return { status: 'error', message: pre.message };

            try {
              const { result, provider } = await runWithProviderFailover(
                searchable.candidates,
                async candidate => {
                  const searchTool = getProviderWebSearchTool(candidate, {
                    alone: true
                  });
                  if (!searchTool) throw new NoSearchError(candidate.name);

                  return generateText({
                    model: getLanguageModel(
                      candidate,
                      searchable.dbModel.modelId
                    ),
                    instructions: SEARCH_INSTRUCTIONS,
                    prompt: query,
                    tools: searchTool,
                    abortSignal: abortSignal
                      ? AbortSignal.any([
                          abortSignal,
                          AbortSignal.timeout(SEARCH_TIMEOUT_MS)
                        ])
                      : AbortSignal.timeout(SEARCH_TIMEOUT_MS),
                    stopWhen: isStepCount(3),
                    maxRetries: 1
                  });
                },
                {
                  shouldRetry: error =>
                    error instanceof NoSearchError ||
                    isRetryableProviderError(error)
                }
              );

              // A call made on the user's behalf, and recorded as one: on
              // the search model, with the searches it made.
              const webSearches = result.steps.reduce(
                (sum, step) => sum + countWebSearches(step),
                0
              );
              await recordChatUsage({
                userId,
                chatId,
                messageId: assistantMessageId,
                modelId: searchable.dbModel.modelId,
                providerId: provider.id,
                providerModelId: resolveModelId(
                  provider,
                  searchable.dbModel.modelId
                ),
                usage: { ...normalizeChatUsage(result.usage), webSearches }
              });

              const seen = new Set<string>();
              const sources: Array<{ title: string; url: string }> = [];
              for (const source of result.sources) {
                if (source.sourceType !== 'url' || seen.has(source.url)) {
                  continue;
                }
                seen.add(source.url);
                sources.push({
                  title: source.title ?? source.url,
                  url: source.url
                });
              }

              return { status: 'done', answer: result.text, sources };
            } catch (err) {
              console.error(
                `[web-search] failed on ${searchable.dbModel.modelId}:`,
                err instanceof Error ? err.message : err
              );
              return { status: 'error', message: SEARCH_ERROR };
            }
          }
        })
      }
    : null;

  // Whether this provider's own search serves: the shared rule, asked of
  // the one provider the stream is being handed to.
  const ownSearch = (candidate: Candidate) =>
    searchesForItself({
      ...rule,
      model: { ...chatModel, providerTypes: [candidate.type] }
    });

  const toolsFor = (candidate: Candidate): ToolSet =>
    (ownSearch(candidate)
      ? getProviderWebSearchTool(candidate, { alone: false })
      : null) ??
    delegate ??
    {};

  // Which provider ends up serving the model is not known yet; the guidance
  // is given when any of them could search, and a model that then gets no
  // tool has none to be tempted by. The same question the page asks before
  // offering the switch.
  const can = canSearchWeb({
    ...rule,
    model: {
      ...chatModel,
      providerTypes: candidates.map(candidate => candidate.type)
    }
  });
  if (!can) return nothing;

  return { toolsFor, systemPrompt: WEB_SEARCH_GUIDANCE };
}
