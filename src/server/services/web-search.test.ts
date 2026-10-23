import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Candidate, type Model } from '@/types';
import { runWithProviderFailover } from '@/lib/provider';
import { preflightCheck } from '@/server/services/preflight';
import { getWebSearchSettings } from '@/server/services/settings';
import { getUserTier } from '@/server/services/tier';
import { recordChatUsage } from '@/server/services/usage';

import { MAX_WEB_SEARCHES_PER_TURN, setupWebSearch } from './web-search';

/**
 * Which search a chat gets, and what a delegated search does. The provider
 * SDKs, the settings row and the usage table are mocked at their module
 * boundaries; the choice between a provider's own search and the delegate,
 * and the delegate's own behaviour, are what is under test.
 */

vi.mock('@/lib/provider', () => ({
  getLanguageModel: vi.fn(() => 'language-model'),
  // The provider's own tool, stood in by a marker that says whose it is.
  getProviderWebSearchTool: vi.fn((candidate: Candidate) => ({
    [candidate.type === 'google' ? 'google_search' : 'web_search']: {
      own: candidate.type
    }
  })),
  // xAI's search of X, stood in the same way; none elsewhere.
  getProviderXSearchTool: vi.fn((candidate: Candidate) =>
    candidate.type === 'xai' ? { x_search: { own: 'xai' } } : null
  ),
  isRetryableProviderError: vi.fn(() => false),
  resolveModelId: vi.fn((_c: Candidate, modelId: string) => modelId),
  runWithProviderFailover: vi.fn()
}));
vi.mock('@/server/services/preflight', () => ({
  preflightCheck: vi.fn(async () => ({ ok: true }))
}));
vi.mock('@/server/services/settings', () => ({
  getWebSearchSettings: vi.fn()
}));
vi.mock('@/server/services/usage', () => ({
  recordChatUsage: vi.fn(async () => {})
}));
// On no tier, every model is allowed.
vi.mock('@/server/services/tier', () => ({
  getUserTier: vi.fn(async () => ({
    modelRestrictionMode: 'allow',
    modelIds: []
  }))
}));

const provider = (type: Candidate['type'], id = type): Candidate =>
  ({ id, name: id, type, isEnabled: true }) as Candidate;

const model = (
  modelId: string,
  extra: Partial<Model> = {},
  providers: Candidate[] = []
): Model =>
  ({
    id: modelId,
    name: modelId,
    modelId,
    capability: 'chat',
    isEnabled: true,
    providers: providers.map(p => ({
      id: `b-${p.id}`,
      modelId,
      providerId: p.id,
      isEnabled: true,
      provider: p
    })),
    ...extra
  }) as unknown as Model;

const searchModel = model('searcher', { supportsWebSearch: true }, [
  provider('google')
]);

const xSearchModel = model('grok', { supportsWebSearch: true }, [
  provider('xai')
]);

const searchingWith = (search: Model | null) =>
  search
    ? {
        dbModel: search,
        candidates: (search.providers ?? []).map(b => b.provider as Candidate)
      }
    : null;

const settings = (
  mode: 'auto' | 'model',
  search: Model | null = searchModel,
  xSearch: Model | null = null
) => {
  vi.mocked(getWebSearchSettings).mockResolvedValue({
    mode,
    searchModel: searchingWith(search),
    xSearchModel: searchingWith(xSearch)
  } as Awaited<ReturnType<typeof getWebSearchSettings>>);
};

const setup = (chatModel: Model) =>
  setupWebSearch({
    userId: 'u1',
    chatId: 'c1',
    assistantMessageId: 'a1',
    chatModel,
    candidates: (chatModel.providers ?? []).map(b => b.provider as Candidate)
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('who searches', () => {
  it('auto: a model with a search of its own uses it', async () => {
    settings('auto');
    const chat = model('gpt', { supportsWebSearch: true }, [
      provider('openai')
    ]);
    const search = await setup(chat);

    expect(search.toolsFor(provider('openai'))).toEqual({
      web_search: { own: 'openai' }
    });
    expect(search.systemPrompt).not.toBe('');
  });

  it('auto: a model without one asks the search model', async () => {
    settings('auto');
    const chat = model('gpt', { supportsWebSearch: false }, [
      provider('openai')
    ]);
    const search = await setup(chat);

    const tools = search.toolsFor(provider('openai'));
    expect(Object.keys(tools)).toEqual(['web_search']);
    expect(tools.web_search).not.toEqual({ own: 'openai' });
    expect(tools.web_search.execute).toBeTypeOf('function');
  });

  it('auto: Gemini with search on searches for itself, beside its other tools', async () => {
    settings('auto');
    const chat = model('gemini', { supportsWebSearch: true }, [
      provider('google')
    ]);
    const search = await setup(chat);

    expect(search.toolsFor(provider('google'))).toEqual({
      google_search: { own: 'google' }
    });
  });

  it('model: the search model answers even for a model with a search of its own', async () => {
    settings('model');
    const chat = model('gpt', { supportsWebSearch: true }, [
      provider('openai')
    ]);
    const search = await setup(chat);

    expect(search.toolsFor(provider('openai')).web_search.execute).toBeTypeOf(
      'function'
    );
  });

  it('two providers behind one model each get their own', async () => {
    settings('auto');
    const chat = model('gpt', { supportsWebSearch: true }, [
      provider('openai'),
      provider('deepseek')
    ]);
    const search = await setup(chat);

    expect(search.toolsFor(provider('openai'))).toEqual({
      web_search: { own: 'openai' }
    });
    expect(search.toolsFor(provider('deepseek')).web_search.execute).toBeTypeOf(
      'function'
    );
  });

  it('no search model and none of its own: no tool, and no mention of one', async () => {
    settings('auto', null);
    const chat = model('deepseek', {}, [provider('deepseek')]);
    const search = await setup(chat);

    expect(search.toolsFor(provider('deepseek'))).toEqual({});
    expect(search.systemPrompt).toBe('');
  });

  it('no search model, but one of its own: its own alone', async () => {
    settings('auto', null);
    const chat = model('gpt', { supportsWebSearch: true }, [
      provider('openai')
    ]);
    const search = await setup(chat);

    expect(search.toolsFor(provider('openai'))).toEqual({
      web_search: { own: 'openai' }
    });
    expect(search.systemPrompt).not.toBe('');
  });

  it('a search model the tier refuses is none: no tool, and no mention of one', async () => {
    settings('auto');
    vi.mocked(getUserTier).mockResolvedValueOnce({
      modelRestrictionMode: 'deny',
      modelIds: ['searcher']
    } as Awaited<ReturnType<typeof getUserTier>>);
    const chat = model('deepseek', {}, [provider('deepseek')]);
    const search = await setup(chat);

    expect(search.toolsFor(provider('deepseek'))).toEqual({});
    expect(search.systemPrompt).toBe('');
  });
});

describe('delegated search', () => {
  /** The delegate tool of a chat model that has no search of its own. */
  async function delegate() {
    settings('auto');
    const chat = model('deepseek', {}, [provider('deepseek')]);
    const search = await setup(chat);
    const tool = search.toolsFor(provider('deepseek')).web_search;
    // Only the query matters to the tool; the SDK's call options do not.
    const execute = tool.execute as unknown as (
      input: { query: string },
      options: Record<string, unknown>
    ) => Promise<unknown>;
    return (query: string) =>
      execute({ query }, { toolCallId: 't1', messages: [], context: {} });
  }

  /** What the search model answered, as `runWithProviderFailover` hands it
   *  back: the generation result, and the provider that made it. */
  const answered = () =>
    vi.mocked(runWithProviderFailover).mockResolvedValue({
      provider: provider('google'),
      result: {
        text: 'Node 26 is current.',
        usage: { inputTokens: 100, outputTokens: 50 },
        steps: [
          {
            content: [],
            providerMetadata: {
              google: { groundingMetadata: { webSearchQueries: ['q'] } }
            },
            response: { id: 'resp-search', headers: {} }
          }
        ],
        sources: [
          { sourceType: 'url', url: 'https://a.example', title: 'A' },
          { sourceType: 'url', url: 'https://a.example', title: 'A again' },
          { sourceType: 'url', url: 'https://b.example' },
          { sourceType: 'document', id: 'd', mediaType: 'x', title: 'D' }
        ]
      }
    });

  it('is recorded on the search model with its search count; sources deduped by address', async () => {
    const search = await delegate();
    answered();

    const output = await search('latest node');

    expect(output).toEqual({
      status: 'done',
      answer: 'Node 26 is current.',
      sources: [
        { title: 'A', url: 'https://a.example' },
        { title: 'https://b.example', url: 'https://b.example' }
      ]
    });
    expect(recordChatUsage).toHaveBeenCalledWith({
      id: expect.any(String),
      userId: 'u1',
      chatId: 'c1',
      messageId: 'a1',
      modelId: 'searcher',
      providerId: 'google',
      providerModelId: 'searcher',
      providerRequests: [{ responseId: 'resp-search' }],
      usage: expect.objectContaining({
        inputTokens: 100,
        outputTokens: 50,
        webSearches: 1
      })
    });
  });

  it('passes the search model’s preflight first; refused is an error result', async () => {
    const search = await delegate();
    vi.mocked(preflightCheck).mockResolvedValueOnce({
      ok: false,
      status: 403,
      kind: 'quota',
      message: 'Over quota.'
    } as never);

    expect(await search('x')).toEqual({
      status: 'error',
      message: 'Over quota.'
    });
    expect(preflightCheck).toHaveBeenCalledWith(
      expect.objectContaining({ modelKey: 'searcher', capability: 'chat' })
    );
    expect(runWithProviderFailover).not.toHaveBeenCalled();
    expect(recordChatUsage).not.toHaveBeenCalled();
  });

  it('a failing search model is an error result, and nothing is recorded', async () => {
    const search = await delegate();
    vi.mocked(runWithProviderFailover).mockRejectedValueOnce(new Error('boom'));

    const output = await search('x');
    expect(output).toMatchObject({ status: 'error' });
    expect((output as { message: string }).message).not.toContain('boom');
    expect(recordChatUsage).not.toHaveBeenCalled();
  });

  it(`a reply gets at most ${MAX_WEB_SEARCHES_PER_TURN} searches; the next is refused without a call`, async () => {
    const search = await delegate();
    answered();

    for (let i = 0; i < MAX_WEB_SEARCHES_PER_TURN; i++) {
      expect(await search(`q${i}`)).toMatchObject({ status: 'done' });
    }
    expect(await search('one more')).toMatchObject({ status: 'error' });
    expect(runWithProviderFailover).toHaveBeenCalledTimes(
      MAX_WEB_SEARCHES_PER_TURN
    );
  });
});

describe('searching X', () => {
  it('auto: a model served through xAI searches X itself, beside its own web search', async () => {
    settings('auto', searchModel, xSearchModel);
    const chat = model('grok-chat', { supportsWebSearch: true }, [
      provider('xai')
    ]);
    const search = await setup(chat);

    expect(search.toolsFor(provider('xai'))).toEqual({
      web_search: { own: 'xai' },
      x_search: { own: 'xai' }
    });
    expect(search.systemPrompt).toContain('x_search');
  });

  it('auto: any other model asks the X search model', async () => {
    settings('auto', searchModel, xSearchModel);
    const chat = model('gpt', { supportsWebSearch: true }, [
      provider('openai')
    ]);
    const search = await setup(chat);

    const tools = search.toolsFor(provider('openai'));
    expect(tools.web_search).toEqual({ own: 'openai' });
    expect(tools.x_search.execute).toBeTypeOf('function');
  });

  it('model: the X search model answers even for a model served through xAI', async () => {
    settings('model', searchModel, xSearchModel);
    const chat = model('grok-chat', { supportsWebSearch: true }, [
      provider('xai')
    ]);
    const search = await setup(chat);

    expect(search.toolsFor(provider('xai')).x_search.execute).toBeTypeOf(
      'function'
    );
  });

  it('no X search model and not served through xAI: no search of X, and no mention of one', async () => {
    settings('auto', searchModel, null);
    const chat = model('gpt', { supportsWebSearch: true }, [
      provider('openai')
    ]);
    const search = await setup(chat);

    expect(search.toolsFor(provider('openai'))).toEqual({
      web_search: { own: 'openai' }
    });
    expect(search.systemPrompt).not.toContain('x_search');
  });

  it('a delegated search of X is recorded on the X search model with what it fetched', async () => {
    settings('auto', null, xSearchModel);
    const chat = model('deepseek', {}, [provider('deepseek')]);
    const search = await setup(chat);
    const execute = search.toolsFor(provider('deepseek')).x_search
      .execute as unknown as (
      input: { query: string },
      options: Record<string, unknown>
    ) => Promise<unknown>;
    vi.mocked(runWithProviderFailover).mockResolvedValue({
      provider: provider('xai'),
      result: {
        text: '@xai posted about Grok.',
        usage: { inputTokens: 100, outputTokens: 20 },
        steps: [
          {
            content: [],
            usage: {
              raw: {
                server_side_tool_usage_details: {
                  x_search_calls: 2,
                  x_posts_fetched: 10,
                  x_users_fetched: 3
                }
              }
            },
            response: { id: 'resp-x', headers: {} }
          }
        ],
        sources: [
          { sourceType: 'url', url: 'https://x.com/xai/status/1', title: '1' }
        ]
      }
    });

    const output = await execute(
      { query: 'what has @xai posted' },
      { toolCallId: 't1', messages: [], context: {} }
    );

    expect(output).toEqual({
      status: 'done',
      answer: '@xai posted about Grok.',
      sources: [{ title: '1', url: 'https://x.com/xai/status/1' }]
    });
    expect(recordChatUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'grok',
        providerId: 'xai',
        usage: expect.objectContaining({
          inputTokens: 100,
          xPosts: 10,
          xProfiles: 3
        })
      })
    );
  });
});
