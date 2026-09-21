import { APICallError, simulateReadableStream, streamText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { isRetryableProviderError } from './provider';
import { openedWithError } from './stream-failover';

// `provider` reaches for the key cipher, and the cipher for the environment.
vi.mock('@/lib/crypto', () => ({ decrypt: (s: string) => s }));

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 }
};

const answering = () =>
  new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: '1' },
          { type: 'text-delta', id: '1', delta: 'Hello' },
          { type: 'text-delta', id: '1', delta: ' there' },
          { type: 'text-end', id: '1' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage
          }
        ] as never
      })
    })
  });

const refusing = (statusCode: number) =>
  new MockLanguageModelV4({
    doStream: async () => {
      throw new APICallError({
        message: 'no',
        url: 'https://provider.test',
        requestBodyValues: {},
        statusCode,
        isRetryable: false
      });
    }
  });

describe('openedWithError', () => {
  it('reports the error a provider opened with, in a form failover can judge', async () => {
    const attempt = streamText({
      model: refusing(401),
      prompt: 'hi',
      maxRetries: 0,
      onError: () => {}
    });

    const failed = await openedWithError(attempt);
    expect(failed).toBeDefined();
    expect(isRetryableProviderError(failed?.error)).toBe(true);
  });

  it('leaves the whole reply for whoever streams it afterwards', async () => {
    const attempt = streamText({ model: answering(), prompt: 'hi' });

    expect(await openedWithError(attempt)).toBeUndefined();

    let text = '';
    for await (const chunk of attempt.toUIMessageStream()) {
      if (chunk.type === 'text-delta') text += chunk.delta;
    }
    expect(text).toBe('Hello there');
  });
});
