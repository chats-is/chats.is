import { describe, expect, it } from 'vitest';

import { type ModelCapability, type ProviderType } from '@/types';
import { vocabularyFor, type VocabField } from '@/lib/provider-vocab';
import { pruneToVocabulary } from '@/components/console/ui-options-field';

describe('pruneToVocabulary', () => {
  it('drops a field the providers have no say in', () => {
    // xAI ignores `size` for images, so a model carrying one is carrying a
    // setting that never leaves the browser.
    expect(
      pruneToVocabulary(
        {
          aspectRatios: ['1:1', '16:9'],
          aspectRatio: '16:9',
          sizes: ['1K', '2K'],
          size: '1K'
        },
        vocabularyFor(['xai'], 'image'),
        'image'
      )
    ).toEqual({ aspectRatios: ['1:1', '16:9'], aspectRatio: '16:9' });
  });

  it('keeps both keys of every field the providers do take', () => {
    expect(
      pruneToVocabulary(
        { sizes: ['1024x1024'], size: '1024x1024' },
        vocabularyFor(['openai'], 'image'),
        'image'
      )
    ).toEqual({ sizes: ['1024x1024'], size: '1024x1024' });
  });

  it('keeps `reasoning` for a chat model and nowhere else', () => {
    expect(
      pruneToVocabulary(
        { reasoning: true, efforts: ['low'] },
        vocabularyFor(['openai'], 'chat'),
        'chat'
      )
    ).toEqual({ reasoning: true, efforts: ['low'] });

    expect(
      pruneToVocabulary(
        { reasoning: true },
        vocabularyFor(['openai'], 'image'),
        'image'
      )
    ).toEqual({});
  });

  it('narrows to the intersection when a model can fail over', () => {
    // Only Google takes a duration for video among these two, so nobody may
    // pin one — and the key goes with it.
    expect(
      pruneToVocabulary(
        { durations: [4, 8], aspectRatios: ['16:9'] },
        vocabularyFor(['google', 'xai'], 'video'),
        'video'
      )
    ).toEqual({ aspectRatios: ['16:9'] });
  });

  it('keeps everything while the providers are still unknown', () => {
    // The provider list arrives a moment after the dialog does, and an empty
    // vocabulary in that moment must not read as "accepts nothing".
    expect(pruneToVocabulary({ sizes: ['1K'] }, {}, 'image')).toEqual({
      sizes: ['1K']
    });
    expect(
      pruneToVocabulary({ efforts: ['low'], reasoning: true }, {}, 'chat')
    ).toEqual({ efforts: ['low'], reasoning: true });
  });

  /**
   * The rule this whole helper exists for: what gets stored is what the
   * editor drew, and nothing else. Written as a sweep over every provider and
   * capability so a field added to the catalogue without a row — or a row
   * without a field — fails here rather than in someone's database.
   */
  it('stores exactly the fields the editor puts on screen', () => {
    const KEYS: Record<VocabField, [string, string]> = {
      aspectRatio: ['aspectRatios', 'aspectRatio'],
      size: ['sizes', 'size'],
      resolution: ['resolutions', 'resolution'],
      duration: ['durations', 'duration'],
      voice: ['voices', 'voice'],
      effort: ['efforts', 'effort']
    };
    const everything = Object.fromEntries([
      ...Object.values(KEYS).flatMap(([list, single]) => [
        [list, ['x']],
        [single, 'x']
      ]),
      ['reasoning', true],
      ['somethingElse', 'x']
    ]);

    const providers: ProviderType[] = [
      'openai',
      'azure',
      'google',
      'vertex',
      'xai',
      'anthropic',
      'deepseek',
      'bedrock'
    ];
    const capabilities: ModelCapability[] = ['chat', 'image', 'video', 'audio'];

    for (const provider of providers) {
      for (const capability of capabilities) {
        const vocabulary = vocabularyFor([provider], capability);
        // An empty vocabulary means the providers are not known yet, which
        // this helper deliberately leaves alone.
        if (Object.keys(vocabulary).length === 0) continue;

        const drawn = (Object.keys(vocabulary) as VocabField[]).flatMap(
          field => KEYS[field]
        );
        if (capability === 'chat') drawn.push('reasoning');

        expect(
          Object.keys(
            pruneToVocabulary(everything, vocabulary, capability)
          ).sort()
        ).toEqual(drawn.sort());
      }
    }
  });
});
