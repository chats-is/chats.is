import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Model, type Provider } from '@/types';

import { generateAndStoreImage } from './image-generation';

/**
 * What a transparent background asks of each provider. The AI SDK's image
 * call and the upload are stubbed; the failover between providers is the
 * real one.
 */

const { generateImageMock, uploadMock } = vi.hoisted(() => ({
  generateImageMock: vi.fn(),
  uploadMock: vi.fn()
}));

vi.mock('ai', async importOriginal => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateImage: generateImageMock
}));
vi.mock('@/lib/provider', async importOriginal => ({
  ...(await importOriginal<typeof import('./provider')>()),
  getImageModel: vi.fn(() => 'image-model')
}));
vi.mock('@/lib/media-upload', () => ({ uploadGeneratedMedia: uploadMock }));
// Reads the app's secret at load; no key is decrypted here.
vi.mock('@/lib/crypto', () => ({ decrypt: (s: string) => s }));

const provider = (type: Provider['type'], id = type): Provider => ({
  id,
  name: id,
  type,
  apiKey: 'enc',
  baseUrl: null,
  apiOptions: null
});

const model = { modelId: 'gpt-image-1.5', name: 'GPT Image' } as Model;
const source = { data: new Uint8Array([1]), mediaType: 'image/jpeg' };

const removeBackground = (candidates: Provider[]) =>
  generateAndStoreImage({
    userId: 'u1',
    prompt: 'Remove the background',
    dbModel: model,
    candidates,
    inputImages: [source],
    transparent: true
  });

beforeEach(() => {
  generateImageMock.mockReset();
  generateImageMock.mockResolvedValue({
    image: { base64: 'AA==', mediaType: 'image/png' },
    usage: {},
    responses: []
  });
  uploadMock.mockReset();
  uploadMock.mockResolvedValue({
    url: 'https://blob/x.png',
    mediaType: 'image/png',
    filename: 'x.png'
  });
});

describe('a transparent background', () => {
  it('is asked of OpenAI as a transparent PNG, beside the admin’s options', async () => {
    await removeBackground([
      { ...provider('openai'), apiOptions: { quality: 'high' } }
    ]);
    expect(generateImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: { text: 'Remove the background', images: [source.data] },
        providerOptions: {
          openai: {
            quality: 'high',
            background: 'transparent',
            outputFormat: 'png'
          }
        }
      })
    );
  });

  it('is asked of Azure the same way', async () => {
    await removeBackground([provider('azure')]);
    expect(generateImageMock.mock.calls[0][0].providerOptions).toEqual({
      azure: { background: 'transparent', outputFormat: 'png' }
    });
  });

  it('passes over a provider that cannot make one, for the next that can', async () => {
    const result = await removeBackground([
      provider('xai'),
      provider('openai')
    ]);
    expect(generateImageMock).toHaveBeenCalledTimes(1);
    expect(result.provider.type).toBe('openai');
  });

  it('is refused, with nothing sent, where no provider can make one', async () => {
    await expect(removeBackground([provider('xai')])).rejects.toThrow(
      'cannot make a transparent background'
    );
    expect(generateImageMock).not.toHaveBeenCalled();
  });

  it('is not asked for when the image is not to be transparent', async () => {
    await generateAndStoreImage({
      userId: 'u1',
      prompt: 'A cat',
      dbModel: model,
      candidates: [provider('openai')]
    });
    expect(generateImageMock.mock.calls[0][0].providerOptions).toBeUndefined();
  });
});
