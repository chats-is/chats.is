import { describe, expect, it } from 'vitest';

import { extractVideoDurationSeconds, extractVideoTokens } from './video-usage';

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

describe('extractVideoTokens', () => {
  it('reads the tokens Seedance counted a clip as', () => {
    expect(
      extractVideoTokens({
        bytedance: { taskId: 't', usage: { completion_tokens: 108_900 } }
      })
    ).toBe(108_900);
  });

  it('is undefined when no provider counted any', () => {
    expect(extractVideoTokens({ xai: { duration: 6 } })).toBeUndefined();
    expect(extractVideoTokens(undefined)).toBeUndefined();
    expect(extractVideoTokens({ bytedance: { usage: null } })).toBeUndefined();
  });
});
