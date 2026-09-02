import { APICallError } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import {
  AllProvidersFailedError,
  bindingsToFailoverProviders,
  isRetryableProviderError,
  runWithProviderFailover,
  toProviderModelId,
  type FailoverProvider
} from './provider';

// provider.ts -> ./crypto -> @/lib/env validates APP_SECRET at module load.
// The functions under test never decrypt, so stub crypto to avoid loading env.
vi.mock('@/lib/crypto', () => ({ decrypt: (s: string) => s }));

function fp(overrides: Partial<FailoverProvider> = {}): FailoverProvider {
  return {
    id: 'p1',
    name: 'P1',
    type: 'openai',
    apiKey: 'k',
    baseUrl: null,
    apiOptions: null,
    ...overrides
  };
}

function apiCallError(statusCode?: number): APICallError {
  return new APICallError({
    message: 'boom',
    url: 'https://example.com',
    requestBodyValues: {},
    statusCode
  });
}

describe('isRetryableProviderError', () => {
  it('retries rate-limit / server / timeout-ish / not-found status codes', () => {
    for (const status of [404, 408, 409, 429, 500, 502, 503]) {
      expect(isRetryableProviderError({ status })).toBe(true);
    }
  });

  it('retries auth failures (a bad key on one provider should fail over)', () => {
    expect(isRetryableProviderError({ status: 401 })).toBe(true);
    expect(isRetryableProviderError({ status: 403 })).toBe(true);
  });

  it('does not retry ordinary client 4xx', () => {
    for (const status of [400, 422]) {
      expect(isRetryableProviderError({ status })).toBe(false);
    }
  });

  it('reads statusCode as well as status (raw SDK error shape)', () => {
    expect(isRetryableProviderError({ statusCode: 503 })).toBe(true);
    expect(isRetryableProviderError({ statusCode: 400 })).toBe(false);
  });

  it('classifies AI SDK APICallError by its statusCode', () => {
    expect(isRetryableProviderError(apiCallError(429))).toBe(true);
    expect(isRetryableProviderError(apiCallError(400))).toBe(false);
  });

  it('treats an APICallError without a status as a retryable network error', () => {
    expect(isRetryableProviderError(apiCallError(undefined))).toBe(true);
  });

  it('retries network-ish error messages', () => {
    expect(isRetryableProviderError(new Error('fetch failed'))).toBe(true);
    expect(isRetryableProviderError(new Error('request timed out'))).toBe(true);
    expect(isRetryableProviderError(new Error('read ECONNRESET'))).toBe(true);
  });

  it('does not retry generic errors or non-errors', () => {
    expect(isRetryableProviderError(new Error('invalid request'))).toBe(false);
    expect(isRetryableProviderError('nope')).toBe(false);
    expect(isRetryableProviderError(null)).toBe(false);
    expect(isRetryableProviderError(undefined)).toBe(false);
  });
});

describe('toProviderModelId', () => {
  it('returns the modelId unchanged for providers without renaming', () => {
    expect(toProviderModelId('openai', 'gpt-4o')).toBe('gpt-4o');
    expect(toProviderModelId('anthropic', 'claude-sonnet')).toBe(
      'claude-sonnet'
    );
    expect(toProviderModelId('azure', 'gpt-4o')).toBe('gpt-4o');
  });

  it('passes unknown ids through for vertex/bedrock', () => {
    expect(toProviderModelId('vertex', 'some-unmapped-id')).toBe(
      'some-unmapped-id'
    );
    expect(toProviderModelId('bedrock', 'some-unmapped-id')).toBe(
      'some-unmapped-id'
    );
  });
});

describe('bindingsToFailoverProviders', () => {
  it('drops bindings without a loaded provider and maps the rest', () => {
    const out = bindingsToFailoverProviders([
      { provider: null },
      {
        provider: {
          id: 'a',
          name: 'A',
          type: 'openai',
          apiKey: 'key',
          baseUrl: 'https://b',
          apiOptions: { x: 1 }
        }
      }
    ]);

    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      id: 'a',
      name: 'A',
      type: 'openai',
      apiKey: 'key',
      baseUrl: 'https://b',
      apiOptions: { x: 1 }
    });
  });
});

describe('runWithProviderFailover', () => {
  it('returns the first success and does not try the rest', async () => {
    const tried: string[] = [];
    const { result, provider } = await runWithProviderFailover(
      [fp({ id: 'a' }), fp({ id: 'b' })],
      async p => {
        tried.push(p.id);
        return `ok:${p.id}`;
      }
    );

    expect(result).toBe('ok:a');
    expect(provider.id).toBe('a');
    expect(tried).toEqual(['a']);
  });

  it('fails over to the next provider on a retryable error', async () => {
    const tried: string[] = [];
    const { result, provider } = await runWithProviderFailover(
      [fp({ id: 'a' }), fp({ id: 'b' })],
      async p => {
        tried.push(p.id);
        if (p.id === 'a') throw { status: 429 };
        return 'ok';
      }
    );

    expect(result).toBe('ok');
    expect(provider.id).toBe('b');
    expect(tried).toEqual(['a', 'b']);
  });

  it('aborts immediately on a non-retryable error', async () => {
    const tried: string[] = [];
    await expect(
      runWithProviderFailover([fp({ id: 'a' }), fp({ id: 'b' })], async p => {
        tried.push(p.id);
        throw { status: 400 };
      })
    ).rejects.toEqual({ status: 400 });

    expect(tried).toEqual(['a']);
  });

  it('throws the last error when every retryable attempt fails', async () => {
    await expect(
      runWithProviderFailover([fp({ id: 'a' }), fp({ id: 'b' })], async p => {
        throw { status: p.id === 'a' ? 429 : 503 };
      })
    ).rejects.toEqual({ status: 503 });
  });

  it('throws AllProvidersFailedError for an empty provider list', async () => {
    await expect(
      runWithProviderFailover([], async () => 'x')
    ).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  it('honors a custom shouldRetry predicate', async () => {
    const tried: string[] = [];
    const { provider } = await runWithProviderFailover(
      [fp({ id: 'a' }), fp({ id: 'b' })],
      async p => {
        tried.push(p.id);
        if (p.id === 'a') throw new Error('anything');
        return 'ok';
      },
      { shouldRetry: () => true }
    );

    expect(provider.id).toBe('b');
    expect(tried).toEqual(['a', 'b']);
  });
});
