import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Model, type ProviderConfig } from '@/types';
import { type FailoverProvider } from '@/lib/provider';

import {
  generateAndStoreVideo,
  generateWithSora,
  VideoTimeoutError
} from './video-generation';

// Shared spies/captures for the mocked SDKs. Hoisted so the vi.mock factories
// (themselves hoisted) can close over them.
const {
  videosCreate,
  videosRetrieve,
  videosDownload,
  openaiCtorArgs,
  azureCtorArgs,
  generateVideoMock,
  uploadMock,
  getVideoModelMock
} = vi.hoisted(() => ({
  videosCreate: vi.fn(),
  videosRetrieve: vi.fn(),
  videosDownload: vi.fn(),
  openaiCtorArgs: [] as any[],
  azureCtorArgs: [] as any[],
  generateVideoMock: vi.fn(),
  uploadMock: vi.fn(),
  getVideoModelMock: vi.fn()
}));

vi.mock('openai', () => {
  const videos = {
    create: videosCreate,
    retrieve: videosRetrieve,
    downloadContent: videosDownload
  };
  class OpenAI {
    videos = videos;
    constructor(opts: any) {
      openaiCtorArgs.push(opts);
    }
  }
  class AzureOpenAI {
    videos = videos;
    constructor(opts: any) {
      azureCtorArgs.push(opts);
    }
  }
  return { default: OpenAI, AzureOpenAI };
});

// decrypt is the only crypto call on the Sora path; make it observable.
vi.mock('@/lib/crypto', () => ({ decrypt: (s: string) => `dec:${s}` }));

// The AI SDK video path (non-sora, non-azure). Partial-mock so the real
// exports the failover path relies on (e.g. APICallError) stay intact.
vi.mock('ai', async importOriginal => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, experimental_generateVideo: generateVideoMock };
});

// Keep the real failover orchestrator + error classification, stub only the
// model factory (which would otherwise build a real provider SDK).
vi.mock('@/lib/provider', async importOriginal => {
  const actual = await importOriginal<typeof import('./provider')>();
  return { ...actual, getVideoModel: getVideoModelMock };
});

// resolveVideoSeconds is exercised in its own suite — here just echo the
// requested duration so the AI SDK path has a deterministic billable value.
vi.mock('@/lib/video-usage', () => ({
  resolveVideoSeconds: (_meta: unknown, duration?: number) => duration ?? 5
}));

// media-upload pulls in @/lib/env at load; stub it and return a fake blob.
vi.mock('@/lib/media-upload', () => ({ uploadGeneratedMedia: uploadMock }));

function azureProvider(
  overrides: Partial<ProviderConfig> = {}
): ProviderConfig {
  return {
    type: 'azure',
    apiKey: 'enc-key',
    baseUrl: 'https://res.openai.azure.com',
    apiOptions: null,
    ...overrides
  };
}

function failover(overrides: Partial<FailoverProvider> = {}): FailoverProvider {
  return {
    id: 'p1',
    name: 'P1',
    type: 'openai',
    apiKey: 'enc',
    baseUrl: null,
    apiOptions: null,
    ...overrides
  };
}

function model(modelId: string): Model {
  return { modelId } as unknown as Model;
}

beforeEach(() => {
  videosCreate.mockReset();
  videosRetrieve.mockReset();
  videosDownload.mockReset();
  generateVideoMock.mockReset();
  uploadMock.mockReset();
  getVideoModelMock.mockReset();
  openaiCtorArgs.length = 0;
  azureCtorArgs.length = 0;

  videosCreate.mockResolvedValue({ id: 'job-1', status: 'completed' });
  videosDownload.mockResolvedValue({
    arrayBuffer: async () => new TextEncoder().encode('video-bytes').buffer
  });
  generateVideoMock.mockResolvedValue({
    video: { uint8Array: new Uint8Array([1, 2, 3]) },
    providerMetadata: {}
  });
  getVideoModelMock.mockReturnValue({});
  uploadMock.mockResolvedValue({
    url: 'https://blob/x.mp4',
    mediaType: 'video/mp4',
    filename: 'x.mp4'
  });
});

describe('generateWithSora — Azure', () => {
  it('uses the AzureOpenAI v1 client with a decrypted key and preview api-version', async () => {
    const result = await generateWithSora(
      'sora-2',
      'a cat',
      azureProvider(),
      '9:16',
      undefined,
      8
    );

    // No plain OpenAI client constructed; exactly one Azure client.
    expect(openaiCtorArgs).toHaveLength(0);
    expect(azureCtorArgs).toHaveLength(1);
    expect(azureCtorArgs[0]).toEqual({
      apiKey: 'dec:enc-key',
      endpoint: 'https://res.openai.azure.com',
      apiVersion: 'preview'
    });

    // Shared create path: deployment as model, bucketed seconds, mapped size.
    expect(videosCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'sora-2',
        size: '720x1280',
        seconds: '8'
      })
    );

    expect(result.mediaType).toBe('video/mp4');
    expect(result.seconds).toBe(8);
    expect(result.buffer.toString()).toBe('video-bytes');
  });

  it('honors an apiVersion override from provider.apiOptions', async () => {
    await generateWithSora(
      'sora-2',
      'a dog',
      azureProvider({ apiOptions: { apiVersion: '2025-04-01-preview' } })
    );

    expect(azureCtorArgs[0].apiVersion).toBe('2025-04-01-preview');
  });

  it('takes the Azure path even when the deployment name lacks "sora"', async () => {
    await generateWithSora('my-video-deploy', 'hi', azureProvider());

    expect(azureCtorArgs).toHaveLength(1);
    expect(videosCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'my-video-deploy' })
    );
  });

  it('throws a helpful error when the Azure endpoint URL is missing', async () => {
    await expect(
      generateWithSora('sora-2', 'x', azureProvider({ baseUrl: null }))
    ).rejects.toThrow(/Azure OpenAI Sora requires the provider endpoint URL/);
    expect(azureCtorArgs).toHaveLength(0);
  });
});

describe('generateWithSora — direct OpenAI (unchanged)', () => {
  it('uses the plain OpenAI client, not Azure', async () => {
    await generateWithSora(
      'sora-2',
      'a bird',
      { type: 'openai', apiKey: 'enc', baseUrl: null, apiOptions: null },
      '16:9'
    );

    expect(azureCtorArgs).toHaveLength(0);
    expect(openaiCtorArgs).toHaveLength(1);
    expect(openaiCtorArgs[0]).toEqual({
      apiKey: 'dec:enc',
      baseURL: undefined
    });
    expect(videosCreate).toHaveBeenCalledWith(
      expect.objectContaining({ size: '1280x720' })
    );
  });
});

describe('generateWithSora — polling & errors', () => {
  it('polls the job until it completes, then downloads', async () => {
    vi.useFakeTimers();
    try {
      videosCreate.mockResolvedValue({ id: 'job-1', status: 'in_progress' });
      videosRetrieve
        .mockResolvedValueOnce({ id: 'job-1', status: 'in_progress' })
        .mockResolvedValueOnce({ id: 'job-1', status: 'completed' });

      const pending = generateWithSora('sora-2', 'x', azureProvider());
      // Fire the 5s wait between the first (in_progress) and second poll.
      await vi.advanceTimersByTimeAsync(5000);
      const result = await pending;

      expect(videosRetrieve).toHaveBeenCalledTimes(2);
      expect(result.buffer.toString()).toBe('video-bytes');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up as a VideoTimeoutError once the poll ceiling is reached', async () => {
    vi.useFakeTimers();
    try {
      videosCreate.mockResolvedValue({ id: 'job-1', status: 'in_progress' });
      videosRetrieve.mockResolvedValue({ id: 'job-1', status: 'in_progress' });

      const pending = generateWithSora('sora-2', 'x', azureProvider());
      const assertion = expect(pending).rejects.toThrow(VideoTimeoutError);
      // 30 attempts x 5s. The deadline has to stay well inside the chat route's
      // 300s budget — at the full budget Vercel kills the function first and
      // the request 504s before this error can be turned into a tool result.
      await vi.advanceTimersByTimeAsync(30 * 5000);
      await assertion;

      expect(videosRetrieve).toHaveBeenCalledTimes(30);
      expect(videosDownload).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws with the provider message when the job fails', async () => {
    videosCreate.mockResolvedValue({ id: 'job-1', status: 'in_progress' });
    videosRetrieve.mockResolvedValue({
      id: 'job-1',
      status: 'failed',
      error: { message: 'flagged content' }
    });

    await expect(
      generateWithSora('sora-2', 'x', azureProvider())
    ).rejects.toThrow(/Sora video generation failed: flagged content/);
  });

  it('aborts before polling when the signal is already aborted', async () => {
    videosCreate.mockResolvedValue({ id: 'job-1', status: 'in_progress' });
    const ac = new AbortController();
    ac.abort();

    await expect(
      generateWithSora(
        'sora-2',
        'x',
        azureProvider(),
        undefined,
        undefined,
        undefined,
        ac.signal
      )
    ).rejects.toThrow();
    expect(videosRetrieve).not.toHaveBeenCalled();
  });
});

describe('generateAndStoreVideo — routing & failover', () => {
  it('routes a sora model through the Sora client, not the AI SDK', async () => {
    const out = await generateAndStoreVideo({
      userId: 'u',
      prompt: 'p',
      dbModel: model('sora-2'),
      candidates: [failover()],
      duration: 8
    });

    expect(videosCreate).toHaveBeenCalledTimes(1);
    expect(generateVideoMock).not.toHaveBeenCalled();
    expect(out.url).toBe('https://blob/x.mp4');
    expect(out.videoSeconds).toBe(8); // sora bucketed duration
    expect(out.provider.id).toBe('p1');
  });

  it('routes any Azure video provider through the Sora client', async () => {
    await generateAndStoreVideo({
      userId: 'u',
      prompt: 'p',
      dbModel: model('grok-style-deploy'),
      candidates: [
        failover({ type: 'azure', baseUrl: 'https://r.openai.azure.com' })
      ]
    });

    expect(azureCtorArgs).toHaveLength(1);
    expect(generateVideoMock).not.toHaveBeenCalled();
  });

  it('routes non-sora non-azure models through the AI SDK generateVideo', async () => {
    const out = await generateAndStoreVideo({
      userId: 'u',
      prompt: 'p',
      dbModel: model('veo-3'),
      candidates: [failover({ type: 'google' })],
      duration: 6
    });

    expect(generateVideoMock).toHaveBeenCalledTimes(1);
    expect(videosCreate).not.toHaveBeenCalled();
    expect(out.videoSeconds).toBe(6); // from the resolveVideoSeconds stub
  });

  it('does not fail over on our own timeout — a fresh render would not help', async () => {
    vi.useFakeTimers();
    try {
      videosCreate.mockResolvedValue({ id: 'job-1', status: 'in_progress' });
      videosRetrieve.mockResolvedValue({ id: 'job-1', status: 'in_progress' });

      const pending = generateAndStoreVideo({
        userId: 'u',
        prompt: 'p',
        dbModel: model('sora-2'),
        candidates: [failover({ id: 'a' }), failover({ id: 'b' })]
      });
      const assertion = expect(pending).rejects.toThrow(VideoTimeoutError);
      await vi.advanceTimersByTimeAsync(30 * 5000);
      await assertion;

      // Only the first provider was tried: retrying restarts the render from
      // zero and spends the rest of the request budget on it.
      expect(videosCreate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('deadlines the AI SDK path, which polls internally with no ceiling', async () => {
    vi.useFakeTimers();
    try {
      // Mimic a provider render that never finishes: resolve only when the
      // signal we hand it aborts.
      generateVideoMock.mockImplementation(
        ({ abortSignal }: { abortSignal: AbortSignal }) =>
          new Promise((_, reject) => {
            abortSignal.addEventListener('abort', () =>
              reject(new Error('The operation was aborted'))
            );
          })
      );

      const pending = generateAndStoreVideo({
        userId: 'u',
        prompt: 'p',
        dbModel: model('veo-3'),
        candidates: [failover({ id: 'a', type: 'google' })]
      });
      const assertion = expect(pending).rejects.toThrow(VideoTimeoutError);
      await vi.advanceTimersByTimeAsync(150_000);
      await assertion;

      expect(uploadMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a user cancellation as itself, not as a timeout', async () => {
    const ac = new AbortController();
    generateVideoMock.mockImplementation(
      ({ abortSignal }: { abortSignal: AbortSignal }) =>
        new Promise((_, reject) => {
          abortSignal.addEventListener('abort', () =>
            reject(new Error('The operation was aborted'))
          );
        })
    );

    const pending = generateAndStoreVideo({
      userId: 'u',
      prompt: 'p',
      dbModel: model('veo-3'),
      candidates: [failover({ id: 'a', type: 'google' })],
      abortSignal: ac.signal
    });
    ac.abort();

    // Our deadline never fired, so this must not be dressed up as a timeout —
    // the user gets "cancelled", not "try a shorter video".
    await expect(pending).rejects.not.toBeInstanceOf(VideoTimeoutError);
  });

  it('fails over to the next provider on a retryable error', async () => {
    videosCreate
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce({ id: 'job-1', status: 'completed' });

    const out = await generateAndStoreVideo({
      userId: 'u',
      prompt: 'p',
      dbModel: model('sora-2'),
      candidates: [failover({ id: 'a' }), failover({ id: 'b' })],
      duration: 4
    });

    expect(videosCreate).toHaveBeenCalledTimes(2);
    expect(out.provider.id).toBe('b');
  });
});
