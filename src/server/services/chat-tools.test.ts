import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Model } from '@/types';
import { findModelByModelId, getAllModels } from '@/server/services/model';
import { getMediaDefaultModelIds } from '@/server/services/settings';
import { getUserTier } from '@/server/services/tier';

import { buildMediaTools } from './chat-tools';

/**
 * Which media tools a reply is offered, and on which model. The models, the
 * admin's defaults and the user's tier are mocked at their module boundaries;
 * the generators are never reached, since nothing here calls a tool.
 */

vi.mock('@/lib/image-generation', () => ({ generateAndStoreImage: vi.fn() }));
vi.mock('@/lib/video-generation', () => ({
  generateAndStoreVideo: vi.fn(),
  VideoTimeoutError: class extends Error {}
}));
vi.mock('@/lib/speech-generation', () => ({
  generateAndStoreSpeech: vi.fn()
}));
vi.mock('@/lib/transcription', () => ({ transcribeAudio: vi.fn() }));
vi.mock('@/lib/provider', () => ({ resolveModelId: vi.fn() }));
vi.mock('@/server/services/blob', () => ({ isOwnBlobUrl: vi.fn() }));
vi.mock('@/server/services/preflight', () => ({ preflightCheck: vi.fn() }));
vi.mock('@/server/services/usage', () => ({
  recordAudioUsage: vi.fn(),
  recordImageUsage: vi.fn(),
  recordTranscriptionUsage: vi.fn(),
  recordVideoUsage: vi.fn()
}));
vi.mock('@/server/services/settings', () => ({
  getMediaDefaultModelIds: vi.fn()
}));
vi.mock('@/server/services/tier', () => ({ getUserTier: vi.fn() }));

const image = (modelId: string): Model =>
  ({
    id: modelId,
    name: modelId,
    modelId,
    capability: 'image',
    isEnabled: true,
    // Its own aspect ratio, which the tool's description lists: how a test
    // tells which model the tool was offered with.
    uiOptions: { aspectRatios: [`ratio-of-${modelId}`] },
    providers: [
      {
        id: `b-${modelId}`,
        modelId,
        providerId: 'p1',
        isEnabled: true,
        priority: 0,
        provider: { id: 'p1', name: 'p1', type: 'openai', isEnabled: true }
      }
    ]
  }) as unknown as Model;

const models = [image('first'), image('second'), image('admin-default')];

vi.mock('@/server/services/model', () => ({
  getAllModels: vi.fn(),
  findModelByModelId: vi.fn(),
  usableCandidates: (model: Model) =>
    (model.providers ?? []).map(binding => binding.provider)
}));

const build = (selected?: string) =>
  buildMediaTools({
    userId: 'u1',
    chatId: 'c1',
    assistantMessageId: 'a1',
    mediaOptions: selected ? { image: { modelId: selected } } : undefined,
    chatMessages: []
  });

const tier = (mode: 'allow' | 'deny', modelIds: string[]) =>
  vi.mocked(getUserTier).mockResolvedValue({
    modelRestrictionMode: mode,
    modelIds
  } as Awaited<ReturnType<typeof getUserTier>>);

/** The image model the tool was offered with, read off its description. */
const imageModelOf = (tools: Awaited<ReturnType<typeof build>>['tools']) =>
  models.find(m =>
    String(tools.generate_image?.description).includes(`ratio-of-${m.modelId}`)
  )?.modelId;

beforeEach(() => {
  vi.clearAllMocks();
  // The service's own row type, which the client-safe `Model` stands in for.
  type Row = Awaited<ReturnType<typeof getAllModels>>[number];
  vi.mocked(getAllModels).mockResolvedValue(models as unknown as Row[]);
  vi.mocked(findModelByModelId).mockImplementation(
    async modelId =>
      models.find(m => m.modelId === modelId) as unknown as Row | undefined
  );
  vi.mocked(getMediaDefaultModelIds).mockResolvedValue({
    imageModelId: 'admin-default'
  } as Awaited<ReturnType<typeof getMediaDefaultModelIds>>);
});

describe('the image tool', () => {
  it('runs on the model the user picked, when their tier allows it', async () => {
    tier('allow', []);
    const { tools } = await build('second');
    expect(imageModelOf(tools)).toBe('second');
  });

  it('falls back to the admin’s default when the pick is refused', async () => {
    tier('deny', ['second']);
    const { tools } = await build('second');
    expect(imageModelOf(tools)).toBe('admin-default');
  });

  it('falls back to the first allowed when the default is refused too', async () => {
    tier('deny', ['second', 'admin-default']);
    const { tools } = await build('second');
    expect(imageModelOf(tools)).toBe('first');
  });

  it('is not offered when the tier allows no image model', async () => {
    tier('allow', ['some-chat-model']);
    const { tools } = await build('second');
    expect(tools.generate_image).toBeUndefined();
  });
});
