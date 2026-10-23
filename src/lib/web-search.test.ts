import { describe, expect, it } from 'vitest';

import { canSearchWeb, canSearchX, hasOwnWebSearch } from './web-search';

const model = (
  supportsWebSearch: boolean,
  ...providerTypes: Parameters<typeof hasOwnWebSearch>[0][]
) => ({ modelId: 'chat', supportsWebSearch, providerTypes });

describe('hasOwnWebSearch', () => {
  it('is OpenAI, Anthropic, xAI and Google’s — not DeepSeek’s, Azure’s or Bedrock’s', () => {
    for (const type of [
      'openai',
      'anthropic',
      'xai',
      'google',
      'vertex'
    ] as const) {
      expect(hasOwnWebSearch(type)).toBe(true);
    }
    for (const type of ['deepseek', 'azure', 'bedrock'] as const) {
      expect(hasOwnWebSearch(type)).toBe(false);
    }
  });
});

describe('canSearchWeb', () => {
  it('is yes whenever a search model is there to ask', () => {
    expect(
      canSearchWeb({
        mode: 'model',
        searchModelId: 'searcher',
        model: model(false, 'deepseek')
      })
    ).toBe(true);
  });

  it('is yes for a model with a search of its own, in auto mode', () => {
    expect(
      canSearchWeb({
        mode: 'auto',
        searchModelId: null,
        model: model(true, 'openai')
      })
    ).toBe(true);
  });

  it('is no without a search model when the model cannot search for itself', () => {
    const none = { mode: 'auto' as const, searchModelId: null };
    // Switch off.
    expect(canSearchWeb({ ...none, model: model(false, 'openai') })).toBe(
      false
    );
    // A provider with no search of its own.
    expect(canSearchWeb({ ...none, model: model(true, 'bedrock') })).toBe(
      false
    );
    expect(canSearchWeb({ ...none, model: model(true, 'deepseek') })).toBe(
      false
    );
    // Model mode, and no search model to send it to.
    expect(
      canSearchWeb({
        mode: 'model',
        searchModelId: null,
        model: model(true, 'openai')
      })
    ).toBe(false);
  });

  it('lets the search model itself search on its own in model mode', () => {
    expect(
      canSearchWeb({
        mode: 'model',
        searchModelId: 'chat',
        model: model(true, 'anthropic')
      })
    ).toBe(true);
  });
});

describe('canSearchX', () => {
  it('is yes whenever an X search model is there to ask', () => {
    expect(
      canSearchX({
        mode: 'model',
        xSearchModelId: 'grok',
        model: model(false, 'deepseek')
      })
    ).toBe(true);
  });

  it('is yes for a model served through xAI with its search on, in auto mode', () => {
    expect(
      canSearchX({
        mode: 'auto',
        xSearchModelId: null,
        model: model(true, 'xai')
      })
    ).toBe(true);
  });

  it('is no for any other provider’s own search, the switch off, or model mode', () => {
    const none = { mode: 'auto' as const, xSearchModelId: null };
    // Its own search is of the web, not of X.
    expect(canSearchX({ ...none, model: model(true, 'openai') })).toBe(false);
    expect(canSearchX({ ...none, model: model(false, 'xai') })).toBe(false);
    expect(
      canSearchX({
        mode: 'model',
        xSearchModelId: null,
        model: model(true, 'xai')
      })
    ).toBe(false);
  });
});
