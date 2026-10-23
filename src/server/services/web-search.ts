import '@tanstack/react-start/server-only';

import {
  generateText,
  isStepCount,
  tool,
  type StepResult,
  type ToolSet
} from 'ai';

import {
  webSearchInputSchema,
  xSearchInputSchema,
  type Candidate,
  type ChatUsage,
  type Model,
  type WebSearchToolOutput
} from '@/types';
import {
  countWebSearches,
  countXSearch,
  normalizeChatUsage
} from '@/lib/chat-usage';
import { allowsModel } from '@/lib/model-access';
import {
  getLanguageModel,
  getProviderWebSearchTool,
  getProviderXSearchTool,
  isRetryableProviderError,
  resolveModelId,
  runWithProviderFailover
} from '@/lib/provider';
import { providerRequestsOf, withRequestTags } from '@/lib/provider-request';
import { generateUUID } from '@/lib/utils';
import {
  canSearchWeb,
  canSearchX,
  searchesForItself,
  searchesXForItself
} from '@/lib/web-search';
import { preflightCheck } from '@/server/services/preflight';
import { getWebSearchSettings } from '@/server/services/settings';
import { getUserTier } from '@/server/services/tier';
import { recordChatUsage } from '@/server/services/usage';

/**
 * How many searches one reply may delegate. Each is a model call of its own,
 * and a model that keeps searching would keep paying — the ceiling holds it
 * to what a reply can reasonably need. The web and X each have their own.
 */
export const MAX_WEB_SEARCHES_PER_TURN = 3;

/** How long one delegated search may take before it is given up on. */
const SEARCH_TIMEOUT_MS = 60_000;

const SEARCH_ERROR = 'The web search failed. Please try again.';
const X_SEARCH_ERROR = 'The search of X failed. Please try again.';

/** What the search model is told: it is a search, not a conversation. */
const SEARCH_INSTRUCTIONS = [
  'You are a web search assistant. Search the web for the query and report what you found: the facts, figures, names and dates that answer it, with the source each came from.',
  'Be concise and factual. Do not address the user, ask questions, or add opinions. Write in the language of the query.'
].join(' ');

/** What the X search model is told: a search of X, not a conversation. */
const X_SEARCH_INSTRUCTIONS = [
  'You are an X search assistant. Search X for the query and report what you found: the posts that answer it, who posted them and when, with the link to each post.',
  'Be concise and factual. Do not address the user, ask questions, or add opinions. Write in the language of the query.'
].join(' ');

/** The rules the chat model follows when it can search. */
const WEB_SEARCH_GUIDANCE = [
  'You can search the web. Search when the answer depends on current events, recent releases, prices, live figures, or anything you cannot be sure of from memory; do not search for what you already know well.',
  'When your answer draws on a search, cite the pages it came from as markdown links in the text. Never mention which model or service performed the search.'
].join(' ');

/** The rules the chat model follows when it can search X. */
const X_SEARCH_GUIDANCE = [
  'You can search X (formerly Twitter) with the x_search tool. For anything on X — what people are posting, what an account (@handle) has said, reactions or trends there — use x_search rather than a web search, which cannot read X.',
  'When your answer draws on it, cite the posts as markdown links in the text. Never mention which model or service performed the search.'
].join(' ');

/** Thrown for a provider that cannot search, so the next one is tried. */
class NoSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoSearchError';
  }
}

export type WebSearchSetup = {
  /**
   * The tools the chat model gets when this provider serves it: its own
   * search where the mode and model allow it, else the delegate tool — or
   * nothing, when no search model is set. The same for X.
   */
  toolsFor: (candidate: Candidate) => ToolSet;
  /** The guidance for the chat model, or nothing when it cannot search. */
  systemPrompt: string;
};

/** A search model as the settings give it: the model, and who serves it. */
type SearchModel = { dbModel: Model; candidates: Candidate[] };

/**
 * A search the chat model hands to a search model: one model call per
 * search, made with that provider's own search tool, recorded on the search
 * model with what the search added to its usage, and answering with what
 * was found and where.
 */
function delegatedSearch(args: {
  searchModel: SearchModel;
  userId: string;
  chatId: string;
  assistantMessageId: string;
  description: string;
  inputSchema: typeof webSearchInputSchema | typeof xSearchInputSchema;
  instructions: string;
  /** The provider's tool the search model searches with, or null where it
   *  has none. */
  searchToolOf: (candidate: Candidate, modelId: string) => ToolSet | null;
  /** What one step of the search added to the call's usage. */
  counted: (step: StepResult<ToolSet>) => Partial<ChatUsage>;
  /** Said when the ceiling is reached. */
  searched: string;
  errorMessage: string;
  logLabel: string;
}) {
  const { searchModel, userId, chatId, assistantMessageId } = args;
  let searches = 0;

  return tool({
    description: args.description,
    inputSchema: args.inputSchema,
    execute: async (
      { query },
      { abortSignal }
    ): Promise<WebSearchToolOutput> => {
      // Counted before the check: the calls of one step arrive together, and
      // would all be through before any was counted.
      if (++searches > MAX_WEB_SEARCHES_PER_TURN) {
        return {
          status: 'error',
          message: `This reply has already ${args.searched} ${MAX_WEB_SEARCHES_PER_TURN} times, which is the most one reply may. Answer from what was found, and tell the user more can be searched in a new message.`
        };
      }

      // Gated like any model the user uses: priced, allowed by their tier,
      // and within their quota. The operator picks the search model; whether
      // this user may use it is the tier's to say.
      const pre = await preflightCheck({
        userId,
        modelKey: searchModel.dbModel.modelId,
        modelLabel: searchModel.dbModel.name,
        capability: 'chat'
      });
      if (!pre.ok) return { status: 'error', message: pre.message };

      // Chosen now, so the call can carry the id it is recorded under.
      const usageId = generateUUID();
      try {
        const { result, provider } = await runWithProviderFailover(
          searchModel.candidates,
          async candidate => {
            const searchTool = args.searchToolOf(
              candidate,
              searchModel.dbModel.modelId
            );
            if (!searchTool) {
              throw new NoSearchError(
                `${candidate.name} cannot search ${args.logLabel}`
              );
            }

            return generateText({
              model: getLanguageModel(candidate, searchModel.dbModel.modelId),
              instructions: args.instructions,
              prompt: query,
              tools: searchTool,
              providerOptions: {
                [candidate.type]: withRequestTags(
                  candidate.type,
                  usageId,
                  candidate.apiOptions
                )
              },
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
              error instanceof NoSearchError || isRetryableProviderError(error)
          }
        );

        // A call made on the user's behalf, and recorded as one: on the
        // search model, with what its searches came to, step by step.
        const searched: Partial<ChatUsage> = {};
        for (const step of result.steps) {
          for (const [key, value] of Object.entries(args.counted(step))) {
            const field = key as keyof ChatUsage;
            searched[field] = (searched[field] ?? 0) + (value ?? 0);
          }
        }
        await recordChatUsage({
          id: usageId,
          userId,
          chatId,
          messageId: assistantMessageId,
          modelId: searchModel.dbModel.modelId,
          providerId: provider.id,
          providerModelId: resolveModelId(
            provider,
            searchModel.dbModel.modelId
          ),
          providerRequests: providerRequestsOf(
            result.steps.map(step => step.response)
          ),
          usage: { ...normalizeChatUsage(result.usage), ...searched }
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
          `[web-search] searching ${args.logLabel} failed on ${searchModel.dbModel.modelId}:`,
          err instanceof Error ? err.message : err
        );
        return { status: 'error', message: args.errorMessage };
      }
    }
  });
}

/**
 * Set up web search for one reply.
 *
 * In `auto` mode a chat model with search of its own uses it — the provider
 * runs the search inside the step, and the step's usage says how many. Any
 * other model, and every model in `model` mode, gets a `web_search` tool that
 * asks the configured search model instead: one model call per search, billed
 * to that model with its search count, and returning what was found and where.
 *
 * X is searched by the same rule beside it: a model served through xAI
 * searches X itself, and any other asks the X search model through an
 * `x_search` tool. Its searches are billed by what they fetched.
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
  const { mode, searchModel, xSearchModel } = await getWebSearchSettings();
  const nothing: WebSearchSetup = { toolsFor: () => ({}), systemPrompt: '' };

  // A search model the user's tier refuses is none for them: the page offers
  // no switch for it, and every search through it would be refused.
  const tier = await getUserTier(userId);
  const usable = (model: SearchModel | null | undefined) =>
    model &&
    model.candidates.length > 0 &&
    allowsModel(tier, model.dbModel.modelId)
      ? model
      : null;
  const searchable = usable(searchModel);
  const xSearchable = usable(xSearchModel);
  const rule = {
    mode,
    searchModelId: searchable?.dbModel.modelId ?? null
  };
  const xRule = {
    mode,
    xSearchModelId: xSearchable?.dbModel.modelId ?? null
  };
  const ids = { userId, chatId, assistantMessageId };

  const delegate: ToolSet | null = searchable
    ? {
        web_search: delegatedSearch({
          ...ids,
          searchModel: searchable,
          description:
            'Search the web and return what was found, with the pages it came from. Use for current or verifiable information.',
          inputSchema: webSearchInputSchema,
          instructions: SEARCH_INSTRUCTIONS,
          searchToolOf: getProviderWebSearchTool,
          counted: step => ({ webSearches: countWebSearches(step) }),
          searched: 'searched',
          errorMessage: SEARCH_ERROR,
          logLabel: 'the web'
        })
      }
    : null;

  const xDelegate: ToolSet | null = xSearchable
    ? {
        x_search: delegatedSearch({
          ...ids,
          searchModel: xSearchable,
          description:
            'Search X (formerly Twitter) and return what was found, with links to the posts. Use for what people are posting, what an account has said, and reactions or trends on X.',
          inputSchema: xSearchInputSchema,
          instructions: X_SEARCH_INSTRUCTIONS,
          searchToolOf: candidate => getProviderXSearchTool(candidate),
          counted: countXSearch,
          searched: 'searched X',
          errorMessage: X_SEARCH_ERROR,
          logLabel: 'X'
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
  const ownXSearch = (candidate: Candidate) =>
    searchesXForItself({
      ...xRule,
      model: { ...chatModel, providerTypes: [candidate.type] }
    });

  const toolsFor = (candidate: Candidate): ToolSet => ({
    ...((ownSearch(candidate)
      ? getProviderWebSearchTool(candidate, chatModel.modelId)
      : null) ??
      delegate ??
      {}),
    ...((ownXSearch(candidate) ? getProviderXSearchTool(candidate) : null) ??
      xDelegate ??
      {})
  });

  // Which provider ends up serving the model is not known yet; the guidance
  // is given when any of them could search, and a model that then gets no
  // tool has none to be tempted by. The same question the page asks before
  // offering the switch.
  const providerTypes = candidates.map(candidate => candidate.type);
  const can = canSearchWeb({
    ...rule,
    model: { ...chatModel, providerTypes }
  });
  const canX = canSearchX({
    ...xRule,
    model: { ...chatModel, providerTypes }
  });
  if (!can && !canX) return nothing;

  return {
    toolsFor,
    systemPrompt: [can && WEB_SEARCH_GUIDANCE, canX && X_SEARCH_GUIDANCE]
      .filter(Boolean)
      .join('\n\n')
  };
}
