import { describe, expect, it } from 'vitest';

import {
  pickAspectRatio,
  pickDuration,
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
    expect(pickAspectRatio('21:9', '16:9', {})).toBeUndefined();
    expect(pickAspectRatio('21:9', '16:9', { aspectRatio: '4:3' })).toBe('4:3');
  });

  it('returns undefined when there are no options at all', () => {
    expect(pickAspectRatio(undefined, undefined, null)).toBeUndefined();
    expect(pickAspectRatio(undefined, undefined, {})).toBeUndefined();
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
    expect(pickSize(undefined, '1024x1024', null)).toBeUndefined();
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

  it("is selected by default when the model's default is 'auto'", () => {
    expect(pickAspectRatio(undefined, undefined, uiOptions)).toBe('auto');
  });

  it('wins as an explicit user selection when listed', () => {
    expect(pickAspectRatio(undefined, 'auto', uiOptions)).toBe('auto');
  });

  it('is ignored when the LLM requests it (omitting already means auto)', () => {
    expect(pickAspectRatio('auto', '16:9', uiOptions)).toBe('16:9');
  });

  it('lets an LLM prompt-derived value beat an auto selection', () => {
    expect(pickAspectRatio('9:16', 'auto', uiOptions)).toBe('9:16');
  });

  it('resolveAutoOption maps auto to undefined at the call boundary', () => {
    expect(resolveAutoOption('auto')).toBeUndefined();
    expect(resolveAutoOption('16:9')).toBe('16:9');
    expect(resolveAutoOption(undefined)).toBeUndefined();
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

  it('returns undefined when the model declares no voices', () => {
    expect(pickVoice(undefined, undefined, {})).toBeUndefined();
  });
});
