import { describe, expect, it } from 'vitest';

import { type ModelUIOptions } from '@/types/model';

import {
  OPTION_DEFAULTS,
  pickAspectRatio,
  pickDuration,
  pickEffort,
  pickResolution,
  pickSize,
  pickVoice,
  resolveAutoOption
} from './media-options';

describe('pickAspectRatio', () => {
  const uiOptions = {
    aspectRatio: '16:9',
    aspectRatios: ['16:9', '1:1', '9:16']
  };

  it('honors a requested value when it is in the allowed list', () => {
    expect(pickAspectRatio('9:16', '16:9', uiOptions)).toBe('9:16');
  });

  it('falls back to the user selection when the requested value is not allowed', () => {
    expect(pickAspectRatio('21:9', '1:1', uiOptions)).toBe('1:1');
  });

  it('falls back to the model default when neither requested nor selected is allowed', () => {
    expect(pickAspectRatio('21:9', '4:3', uiOptions)).toBe('16:9');
  });

  it('falls back to the first allowed option when nothing else matches', () => {
    expect(
      pickAspectRatio(undefined, undefined, { aspectRatios: ['1:1', '9:16'] })
    ).toBe('1:1');
  });

  it('ignores requested and selected values when the model declares no list', () => {
    // Without an admin-declared list the model renders no selector, so a
    // request-body selection can only be a stale cross-model value — only the
    // model's own default applies.
    expect(pickAspectRatio('21:9', '16:9', {})).toBe(
      OPTION_DEFAULTS.aspectRatio
    );
    expect(pickAspectRatio('21:9', '16:9', { aspectRatio: '4:3' })).toBe('4:3');
  });

  it("ends in the app's own default when there are no options at all", () => {
    expect(pickAspectRatio(undefined, undefined, null)).toBe(
      OPTION_DEFAULTS.aspectRatio
    );
    expect(pickAspectRatio(undefined, undefined, {})).toBe(
      OPTION_DEFAULTS.aspectRatio
    );
  });

  it('uses the singular default when only it is set', () => {
    expect(pickAspectRatio(undefined, undefined, { aspectRatio: '16:9' })).toBe(
      '16:9'
    );
  });
});

describe('pickSize', () => {
  it('validates against sizes and falls back through selection → default', () => {
    const uiOptions = { size: '1024x1024', sizes: ['1024x1024', '512x512'] };
    expect(pickSize('512x512', undefined, uiOptions)).toBe('512x512');
    expect(pickSize('2048x2048', '512x512', uiOptions)).toBe('512x512');
    expect(pickSize('2048x2048', '768x768', uiOptions)).toBe('1024x1024');
  });

  it('ignores the user selection without a declared list (stale cross-model value)', () => {
    expect(pickSize(undefined, '1024x1024', null)).toBe(OPTION_DEFAULTS.size);
    expect(pickSize(undefined, '1024x1024', { size: '512x512' })).toBe(
      '512x512'
    );
  });
});

describe('pickDuration', () => {
  const uiOptions = { duration: 6, durations: [4, 6, 8] };

  it('honors an allowed requested duration', () => {
    expect(pickDuration(8, 4, uiOptions)).toBe(8);
  });

  it('rejects an out-of-list duration in favor of the selection', () => {
    expect(pickDuration(30, 4, uiOptions)).toBe(4);
  });

  it('falls back to the model default', () => {
    expect(pickDuration(30, 12, uiOptions)).toBe(6);
  });
});

describe('pickResolution', () => {
  it('resolves through the same precedence', () => {
    const uiOptions = { resolution: '720p', resolutions: ['720p', '1080p'] };
    expect(pickResolution('1080p', '720p', uiOptions)).toBe('1080p');
    expect(pickResolution('4k', '1080p', uiOptions)).toBe('1080p');
    expect(pickResolution('4k', '480p', uiOptions)).toBe('720p');
  });
});

describe("the 'auto' option", () => {
  const uiOptions = {
    aspectRatio: 'auto',
    aspectRatios: ['auto', '16:9', '9:16']
  };

  it('is the absence of a choice, so the next step decides', () => {
    // The model's own default is 'auto', which pins nothing either, so what
    // is left is the first option the model actually offers.
    expect(pickAspectRatio(undefined, undefined, uiOptions)).toBe('16:9');
  });

  it('drops out when the user selects it, rather than winning', () => {
    expect(pickAspectRatio(undefined, 'auto', uiOptions)).toBe('16:9');
  });

  it('falls to the model default when there is a real one', () => {
    const pinned = {
      aspectRatio: '9:16',
      aspectRatios: ['auto', '16:9', '9:16']
    };
    expect(pickAspectRatio(undefined, 'auto', pinned)).toBe('9:16');
  });

  it('is ignored when the LLM requests it', () => {
    expect(pickAspectRatio('auto', '16:9', uiOptions)).toBe('16:9');
  });

  it('lets an LLM prompt-derived value beat an auto selection', () => {
    expect(pickAspectRatio('9:16', 'auto', uiOptions)).toBe('9:16');
  });

  it('never comes out the other side — the provider is not asked to decide', () => {
    expect(pickAspectRatio(undefined, 'auto', uiOptions)).not.toBe('auto');
    expect(
      pickSize(undefined, 'auto', { size: 'auto', sizes: ['auto', '2K'] })
    ).toBe('2K');
  });

  it("falls to the app's own default when the model declares nothing", () => {
    expect(pickAspectRatio(undefined, 'auto', { aspectRatio: 'auto' })).toBe(
      OPTION_DEFAULTS.aspectRatio
    );
    expect(pickAspectRatio(undefined, 'auto', {})).toBe(
      OPTION_DEFAULTS.aspectRatio
    );
  });

  it('works the same for a duration, whose values are numbers', () => {
    const durations: ModelUIOptions = {
      duration: 'auto',
      durations: ['auto', 4, 8, 12]
    };
    // Nothing selected — which is also what a menu set to Auto sends, since
    // 'auto' does not travel — and a model default that pins nothing either.
    expect(pickDuration(undefined, undefined, durations)).toBe(4);
    // The LLM asking for a length still wins...
    expect(pickDuration(8, undefined, durations)).toBe(8);
    // ...and a length the model does not offer still does not.
    expect(pickDuration(30, undefined, durations)).toBe(4);
    // A pinned length the model does offer beats the fallthrough.
    expect(pickDuration(undefined, 12, durations)).toBe(12);
  });

  it('resolveAutoOption maps auto to undefined', () => {
    expect(resolveAutoOption('auto')).toBeUndefined();
    expect(resolveAutoOption('16:9')).toBe('16:9');
    expect(resolveAutoOption(undefined)).toBeUndefined();
  });
});

describe('pickEffort', () => {
  const ui: ModelUIOptions = {
    effort: 'medium',
    efforts: ['low', 'medium', 'high', 'xhigh']
  };

  it('uses what the user pinned', () => {
    expect(pickEffort(undefined, 'high', ui)).toBe('high');
  });

  it('falls to the model default when nothing is pinned', () => {
    expect(pickEffort(undefined, undefined, ui)).toBe('medium');
  });

  it('ignores a level this model does not offer', () => {
    expect(pickEffort(undefined, 'minimal', ui)).toBe('medium');
  });

  it('falls to the first level listed when there is no model default', () => {
    expect(pickEffort(undefined, undefined, { efforts: ['low', 'high'] })).toBe(
      'low'
    );
  });

  it("leaves it to the provider where the model says nothing — the SDK's own word for it", () => {
    expect(pickEffort(undefined, 'high', {})).toBe('provider-default');
    expect(pickEffort(undefined, undefined, null)).toBe('provider-default');
  });
});

describe('pickVoice', () => {
  const uiOptions = { voice: 'alloy', voices: ['alloy', 'nova'] };

  it('rejects a voice not offered by the model', () => {
    expect(pickVoice(undefined, 'onyx', uiOptions)).toBe('alloy');
  });

  it('accepts a valid selected voice', () => {
    expect(pickVoice(undefined, 'nova', uiOptions)).toBe('nova');
  });

  it("falls to the app's own default when the model declares no voices", () => {
    expect(pickVoice(undefined, undefined, {})).toBe(OPTION_DEFAULTS.voice);
  });

  it('never returns nothing, whatever the model declares', () => {
    for (const ui of [null, {}, { sizes: [] }, { aspectRatios: ['auto'] }]) {
      expect(pickAspectRatio(undefined, undefined, ui)).toBeDefined();
      expect(pickSize(undefined, undefined, ui)).toBeDefined();
      expect(pickResolution(undefined, undefined, ui)).toBeDefined();
      expect(pickDuration(undefined, undefined, ui)).toBeDefined();
      expect(pickVoice(undefined, undefined, ui)).toBeDefined();
    }
  });
});
