import { describe, expect, it, vi } from 'vitest';

import type { PricingRecord } from '@/types';

import {
  calculateAudioCost,
  calculateChatCost,
  calculateImageCost,
  calculateTranscriptionCost,
  calculateVideoCost,
  PricingMissingError,
  pricingMissingFields
} from './pricing';

// pricing.ts imports `@/server/db` (which opens a Neon Pool + validates env)
// at module load. The cost functions under test never touch the DB, so stub it.
vi.mock('@/server/db', () => ({ db: {}, modelPricings: {}, models: {} }));

/** Build a full PricingRecord with all rates null, overriding only what a test needs. */
function pricing(overrides: Partial<PricingRecord> = {}): PricingRecord {
  return {
    id: 'p1',
    modelId: 'test-model',
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
    reasoning: null,
    image: null,
    video: null,
    videoSeconds: null,
    audioInput: null,
    audioOutput: null,
    audioCharacters: null,
    audioSeconds: null,
    source: 'manual',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  } as PricingRecord;
}

describe('calculateChatCost', () => {
  it('returns 0 and empty snapshot when pricing is null', () => {
    const { cost, snapshot } = calculateChatCost({ inputTokens: 1000 }, null);
    expect(cost).toBe(0);
    expect(snapshot.inputPrice).toBeNull();
  });

  it('bills input + output per million tokens', () => {
    const { cost } = calculateChatCost(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      pricing({ input: '3', output: '15' })
    );
    expect(cost).toBe(18);
  });

  it('bills each disjoint bucket at its own rate (cache read + write)', () => {
    // Inputs are pre-normalized disjoint buckets (see normalizeChatUsage):
    //   plain input 1M, cacheRead 2M, cacheWrite 0.5M
    const { cost } = calculateChatCost(
      {
        inputTokens: 1_000_000,
        cacheReadTokens: 2_000_000,
        cacheWriteTokens: 500_000,
        outputTokens: 0
      },
      pricing({ input: '3', cacheRead: '0.3', cacheWrite: '3.75' })
    );
    // 1M*3 + 2M*0.3 + 0.5M*3.75, per 1M = 3 + 0.6 + 1.875 = 5.475
    expect(cost).toBeCloseTo(5.475, 10);
  });

  it('bills text output and reasoning separately; reasoning falls back to output rate', () => {
    // Disjoint: text output 600k, reasoning 400k. Reasoning rate unset → output rate.
    const { cost, snapshot } = calculateChatCost(
      { outputTokens: 600_000, reasoningTokens: 400_000 },
      pricing({ output: '15' })
    );
    // 600k*15 + 400k*15, per 1M = 9 + 6 = 15
    expect(cost).toBeCloseTo(15, 10);
    expect(snapshot.reasoningPrice).toBe('15');
  });

  it('uses explicit reasoning rate for the reasoning bucket', () => {
    const { cost, snapshot } = calculateChatCost(
      { outputTokens: 600_000, reasoningTokens: 400_000 },
      pricing({ output: '15', reasoning: '30' })
    );
    // 600k*15 + 400k*30, per 1M = 9 + 12 = 21
    expect(cost).toBeCloseTo(21, 10);
    expect(snapshot.reasoningPrice).toBe('30');
  });

  it('treats unset rates as free (0)', () => {
    const { cost } = calculateChatCost(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      pricing({ input: '3' }) // output unset
    );
    expect(cost).toBe(3);
  });
});

describe('calculateImageCost', () => {
  it('per-image model: imageCount × image rate', () => {
    const { cost, snapshot } = calculateImageCost(
      { imageCount: 3 },
      pricing({ image: '0.04' })
    );
    expect(cost).toBeCloseTo(0.12, 10);
    expect(snapshot.imagePrice).toBe('0.04');
    expect(snapshot.inputPrice).toBeNull();
  });

  it('token-billed model (gpt-image-1): bills input/output tokens, not per image', () => {
    // Regression: gpt-image-1 bills by token; per-image must NOT apply.
    const { cost, snapshot } = calculateImageCost(
      { imageCount: 1, inputTokens: 1_000_000, outputTokens: 1_000_000 },
      pricing({ input: '5', output: '40' })
    );
    expect(cost).toBe(45);
    expect(snapshot.imagePrice).toBeNull();
    expect(snapshot.inputPrice).toBe('5');
    expect(snapshot.outputPrice).toBe('40');
  });

  it('per-image wins and does NOT double-charge when both styles set (misconfig)', () => {
    const { cost, snapshot } = calculateImageCost(
      { imageCount: 2, inputTokens: 1_000_000, outputTokens: 1_000_000 },
      pricing({ image: '0.04', input: '5', output: '40' })
    );
    // only per-image applies: 2 * 0.04
    expect(cost).toBeCloseTo(0.08, 10);
    expect(snapshot.imagePrice).toBe('0.04');
    expect(snapshot.inputPrice).toBeNull();
  });

  it('returns 0 when pricing is null', () => {
    expect(calculateImageCost({ imageCount: 5 }, null).cost).toBe(0);
  });
});

describe('calculateVideoCost', () => {
  it('per-second mode (Sora/Veo/Runway): seconds × rate', () => {
    const { cost, snapshot } = calculateVideoCost(
      { videoCount: 1, videoSeconds: 10 },
      pricing({ videoSeconds: '0.1' }) // $0.10/s
    );
    expect(cost).toBeCloseTo(1, 10); // 10 * 0.1
    expect(snapshot.videoSecondsPrice).toBe('0.1');
    expect(snapshot.videoPrice).toBeNull();
  });

  it('per-video mode (flat per clip): count × rate', () => {
    const { cost, snapshot } = calculateVideoCost(
      { videoCount: 2, videoSeconds: 10 },
      pricing({ video: '0.5' })
    );
    expect(cost).toBeCloseTo(1, 10); // 2 * 0.5 (seconds ignored)
    expect(snapshot.videoPrice).toBe('0.5');
    expect(snapshot.videoSecondsPrice).toBeNull();
  });

  it('per-video wins and does NOT also charge seconds when both set (misconfig)', () => {
    const { cost } = calculateVideoCost(
      { videoCount: 2, videoSeconds: 10 },
      pricing({ video: '0.5', videoSeconds: '0.1' })
    );
    expect(cost).toBeCloseTo(1, 10); // only per-video: 2 * 0.5
  });

  it('returns 0 when pricing is null', () => {
    expect(calculateVideoCost({ videoCount: 1 }, null).cost).toBe(0);
  });
});

describe('calculateAudioCost', () => {
  it('per-character mode (classic TTS): characters × rate per 1M', () => {
    const { cost, snapshot } = calculateAudioCost(
      { audioCharacters: 500_000 },
      pricing({ audioCharacters: '15' }) // tts-1 = $15 / 1M chars
    );
    expect(cost).toBeCloseTo(7.5, 10); // 500k * 15 / 1M
    expect(snapshot.audioCharactersPrice).toBe('15');
    expect(snapshot.audioInputPrice).toBeNull();
  });

  it('per-token mode: input/output tokens × rate per 1M', () => {
    const { cost, snapshot } = calculateAudioCost(
      { audioInputTokens: 1_000_000, audioOutputTokens: 1_000_000 },
      pricing({ audioInput: '2', audioOutput: '4' })
    );
    expect(cost).toBe(6);
    expect(snapshot.audioInputPrice).toBe('2');
    expect(snapshot.audioCharactersPrice).toBeNull();
  });

  it('per-character wins and does NOT also charge tokens when both set (misconfig)', () => {
    const { cost, snapshot } = calculateAudioCost(
      {
        audioCharacters: 500_000,
        audioInputTokens: 1_000_000,
        audioOutputTokens: 1_000_000
      },
      pricing({ audioCharacters: '15', audioInput: '2', audioOutput: '4' })
    );
    expect(cost).toBeCloseTo(7.5, 10); // only per-character applies
    expect(snapshot.audioInputPrice).toBeNull();
  });

  it('returns 0 when pricing is null', () => {
    expect(calculateAudioCost({ audioCharacters: 1000 }, null).cost).toBe(0);
  });
});

describe('PricingMissingError', () => {
  it('names the missing fields in both the log line and the user message', () => {
    const err = new PricingMissingError('Veo 3', ['Per video', 'Per second']);

    // Log line: keeps the existing "not configured for billing: missing ..."
    // shape so server logs stay greppable.
    expect(err.message).toBe(
      'Model Veo 3 is not configured for billing: missing Per video, Per second.'
    );

    // User message says what is actually wrong and where to fix it — the model
    // is not "unavailable", it is unpriced, and picking another model is not
    // the fix.
    expect(err.userMessage).toBe(
      'Veo 3 is missing pricing for Per video, Per second. Fill it in under Console → Pricing.'
    );
    expect(err.userMessage).not.toMatch(/unavailable|choose a different/i);
  });

  it('reports a wholly absent pricing row differently from a partial one', () => {
    const err = new PricingMissingError('GPT-4o');

    expect(err.message).toBe(
      'Model GPT-4o is not configured for billing. Set a price (or 0) in the Pricing console.'
    );
    expect(err.userMessage).toBe(
      'GPT-4o has no pricing yet. Set it under Console → Pricing (0 is fine) to enable the model.'
    );
  });
});

describe('calculateTranscriptionCost', () => {
  it('bills per second of input audio', () => {
    const { cost, snapshot } = calculateTranscriptionCost(
      { audioSeconds: 90 },
      pricing({ audioSeconds: '0.0001' })
    );
    expect(cost).toBeCloseTo(0.009, 10);
    expect(snapshot.audioSecondsPrice).toBe('0.0001');
  });

  it('returns 0 for null pricing or missing duration', () => {
    expect(calculateTranscriptionCost({ audioSeconds: 60 }, null).cost).toBe(0);
    expect(
      calculateTranscriptionCost({}, pricing({ audioSeconds: '0.0001' })).cost
    ).toBe(0);
  });
});

describe('pricingMissingFields', () => {
  it('audio accepts per-second (STT) as a valid pricing style', () => {
    expect(pricingMissingFields('audio', pricing())).toEqual([
      'Per 1M characters, Audio input / Audio output, or Per second'
    ]);
    expect(
      pricingMissingFields('audio', pricing({ audioSeconds: '0.0001' }))
    ).toEqual([]);
  });

  it('audio direction must match the billed dimension', () => {
    // STT models must carry the per-second rate — a chars/token-only row
    // would pass the gate but bill $0.
    expect(
      pricingMissingFields('audio', pricing({ audioCharacters: '15' }), {
        transcription: true
      })
    ).toEqual(['Per second']);
    expect(
      pricingMissingFields('audio', pricing({ audioSeconds: '0.0001' }), {
        transcription: true
      })
    ).toEqual([]);
    // TTS models must carry chars/tokens — a seconds-only row is invalid.
    expect(
      pricingMissingFields('audio', pricing({ audioSeconds: '0.0001' }), {
        transcription: false
      })
    ).toEqual(['Per 1M characters, or Audio input / Audio output']);
    expect(
      pricingMissingFields('audio', pricing({ audioCharacters: '15' }), {
        transcription: false
      })
    ).toEqual([]);
  });

  it('chat requires input and output', () => {
    expect(pricingMissingFields('chat', pricing())).toEqual([
      'Input',
      'Output'
    ]);
    expect(pricingMissingFields('chat', pricing({ input: '1' }))).toEqual([
      'Output'
    ]);
    expect(
      pricingMissingFields('chat', pricing({ input: '1', output: '2' }))
    ).toEqual([]);
  });

  it('image accepts per-image OR input+output', () => {
    expect(pricingMissingFields('image', pricing({ image: '0.04' }))).toEqual(
      []
    );
    expect(
      pricingMissingFields('image', pricing({ input: '5', output: '40' }))
    ).toEqual([]);
    expect(pricingMissingFields('image', pricing({ input: '5' }))).not.toEqual(
      []
    );
    expect(pricingMissingFields('image', pricing())).not.toEqual([]);
  });

  it('video accepts per-video OR per-second', () => {
    expect(pricingMissingFields('video', pricing({ video: '0.5' }))).toEqual(
      []
    );
    expect(
      pricingMissingFields('video', pricing({ videoSeconds: '0.1' }))
    ).toEqual([]);
    expect(pricingMissingFields('video', pricing())).not.toEqual([]);
  });

  it('audio accepts per-character OR token (input/output)', () => {
    expect(
      pricingMissingFields('audio', pricing({ audioCharacters: '15' }))
    ).toEqual([]);
    expect(pricingMissingFields('audio', pricing({ audioInput: '2' }))).toEqual(
      []
    );
    expect(
      pricingMissingFields('audio', pricing({ audioOutput: '4' }))
    ).toEqual([]);
    expect(pricingMissingFields('audio', pricing())).not.toEqual([]);
  });
});
