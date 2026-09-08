import { describe, expect, it } from 'vitest';

import {
  defaultVoice,
  toRequestParts,
  vocabularyFor
} from '@/lib/provider-vocab';

describe('vocabularyFor', () => {
  it('offers a provider only what that provider takes', () => {
    expect(vocabularyFor(['openai'], 'image')).toEqual({
      size: ['1024x1024', '1024x1536', '1536x1024']
    });
    // No aspect ratio for OpenAI images: its SDK warns and asks for a size.
    expect(vocabularyFor(['openai'], 'image').aspectRatio).toBeUndefined();
    // And no size for xAI images, which ignores the parameter outright.
    expect(vocabularyFor(['xai'], 'image').size).toBeUndefined();
  });

  it('reads an alias off the provider it stands in for', () => {
    expect(vocabularyFor(['azure'], 'image')).toEqual(
      vocabularyFor(['openai'], 'image')
    );
    expect(vocabularyFor(['vertex'], 'video')).toEqual(
      vocabularyFor(['google'], 'video')
    );
  });

  it('intersects across the providers a model can fail over to', () => {
    // Both take a ratio, but only the values both accept survive.
    expect(vocabularyFor(['google', 'xai'], 'video').aspectRatio).toEqual([
      '16:9',
      '9:16'
    ]);
    // One offers durations and the other does not, so nobody may pin one.
    expect(vocabularyFor(['google', 'xai'], 'video').duration).toBeUndefined();
    expect(vocabularyFor(['openai', 'azure'], 'audio')).toEqual(
      vocabularyFor(['openai'], 'audio')
    );
  });

  it('is empty for a provider that cannot do the capability at all', () => {
    expect(vocabularyFor(['anthropic'], 'image')).toEqual({});
    expect(vocabularyFor([], 'chat')).toEqual({});
  });
});

describe('toRequestParts', () => {
  it('drops what the provider has no parameter for', () => {
    // Sora names its output by pixels and has never had a resolution.
    expect(
      toRequestParts('openai', 'image', {
        size: '1024x1024',
        aspectRatio: '16:9',
        resolution: '2K'
      })
    ).toEqual({
      top: { size: '1024x1024' },
      provider: {},
      imageConfig: {}
    });
  });

  it("puts Gemini's image settings where Gemini reads them", () => {
    // `imageSize`, not `size`: the field takes 512/1K/2K/4K, so a pixel
    // string sent here would be rejected.
    expect(
      toRequestParts(
        'google',
        'image',
        { aspectRatio: '16:9', resolution: '2K', size: '1024x1024' },
        { inline: true }
      )
    ).toEqual({
      top: {},
      provider: {},
      imageConfig: { aspectRatio: '16:9', imageSize: '2K' }
    });
  });

  it('addresses the same values differently for the image API', () => {
    // Imagen takes the ratio as a call parameter and has no nested object.
    expect(
      toRequestParts('google', 'image', {
        aspectRatio: '16:9',
        resolution: '2K'
      })
    ).toEqual({
      top: { aspectRatio: '16:9' },
      provider: {},
      imageConfig: {}
    });
  });

  it("keeps xAI's resolution in its own namespace", () => {
    expect(
      toRequestParts('xai', 'video', {
        aspectRatio: '16:9',
        resolution: '720p',
        duration: 6
      })
    ).toEqual({
      top: { aspectRatio: '16:9', duration: 6 },
      provider: { resolution: '720p' },
      imageConfig: {}
    });
  });

  it('drops a value the provider does not accept for that field', () => {
    // The chain's fixed fallback for a resolution is a video tier; xAI's
    // image models take 1k or 2k, and sending 480p would fail the request.
    expect(toRequestParts('xai', 'image', { resolution: '480p' })).toEqual({
      top: {},
      provider: {},
      imageConfig: {}
    });
    // The same value is fine one capability over.
    expect(toRequestParts('xai', 'video', { resolution: '480p' })).toEqual({
      top: {},
      provider: { resolution: '480p' },
      imageConfig: {}
    });
    // And a size the chain settled for some other model is not xAI's to take.
    expect(toRequestParts('openai', 'image', { size: '2048x2048' })).toEqual({
      top: {},
      provider: {},
      imageConfig: {}
    });
  });

  it('sends nothing for a value nobody settled', () => {
    expect(toRequestParts('xai', 'image', { aspectRatio: undefined })).toEqual({
      top: {},
      provider: {},
      imageConfig: {}
    });
  });
});

describe('defaultVoice', () => {
  it('names each provider its own default', () => {
    expect(defaultVoice('openai')).toBe('alloy');
    expect(defaultVoice('azure')).toBe('alloy');
    expect(defaultVoice('google')).toBe('Kore');
    expect(defaultVoice('vertex')).toBe('Kore');
    expect(defaultVoice('xai')).toBe('eve');
  });

  it('has none for a provider that does not speak', () => {
    expect(defaultVoice('anthropic')).toBeUndefined();
  });
});
