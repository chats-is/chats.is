import { describe, expect, it } from 'vitest';

import {
  extractVideoDurationSeconds,
  resolveVideoSeconds
} from './video-usage';

describe('extractVideoDurationSeconds', () => {
  it('reads provider duration from videos[].duration (fal shape)', () => {
    expect(
      extractVideoDurationSeconds({
        fal: { videos: [{ duration: 5, fps: 24 }] }
      })
    ).toBe(5);
  });

  it('reads a top-level provider duration', () => {
    expect(extractVideoDurationSeconds({ runway: { duration: 8 } })).toBe(8);
  });

  it('returns undefined when no provider reports duration', () => {
    expect(extractVideoDurationSeconds(undefined)).toBeUndefined();
    expect(extractVideoDurationSeconds({})).toBeUndefined();
    expect(extractVideoDurationSeconds({ veo: { fps: 24 } })).toBeUndefined();
    expect(
      extractVideoDurationSeconds({ x: { videos: [{ duration: 0 }] } })
    ).toBeUndefined();
  });
});

describe('resolveVideoSeconds', () => {
  it('prefers the provider-reported actual duration over requested', () => {
    expect(
      resolveVideoSeconds({ fal: { videos: [{ duration: 6 }] } }, 10)
    ).toBe(6);
  });

  it('falls back to the requested duration when provider has none', () => {
    expect(resolveVideoSeconds({}, 10)).toBe(10);
    expect(resolveVideoSeconds(undefined, 8)).toBe(8);
  });

  it('returns undefined when neither is available (caller must surface it)', () => {
    expect(resolveVideoSeconds({}, undefined)).toBeUndefined();
    expect(resolveVideoSeconds(undefined, 0)).toBeUndefined();
    expect(resolveVideoSeconds(undefined, 'bad')).toBeUndefined();
  });
});
