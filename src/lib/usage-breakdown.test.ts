import { describe, expect, it } from 'vitest';

import { usageBreakdown, usageSummary } from '@/lib/usage-breakdown';

const total = (items: { subtotal: number }[]) =>
  items.reduce((sum, item) => sum + item.subtotal, 0);

describe('usageBreakdown', () => {
  it("shows the user's prices — the cost price at their tier's multiplier — adding up to the spend", () => {
    // 1M input tokens at a $1 cost price, on a tier of 1.5: the price shown
    // is $1.5, the item $1.5, and that is the spend.
    const items = usageBreakdown({
      capability: 'chat',
      inputTokens: 1_000_000,
      inputPrice: '1.0000000000',
      priceMultiplier: '1.5000'
    });
    expect(items).toEqual([
      {
        label: 'Input',
        quantity: '1,000,000 tokens',
        rate: '$1.5 / 1M tokens',
        subtotal: 1.5
      }
    ]);
  });

  it('bills each chat bucket at its own rate, adding up to the cost', () => {
    // A recorded gpt-5.5 row, charged $0.017736.
    const row = {
      capability: 'chat' as const,
      inputTokens: 2406,
      outputTokens: 21,
      reasoningTokens: 166,
      cacheReadTokens: 192,
      cacheWriteTokens: 0,
      inputPrice: '5.0000000000',
      outputPrice: '30.0000000000',
      reasoningPrice: '30.0000000000',
      cacheReadPrice: '0.5000000000',
      cacheWritePrice: '0.0000000000'
    };
    const items = usageBreakdown(row);
    expect(items.map(i => i.label)).toEqual([
      'Input',
      'Cache read',
      'Output',
      'Reasoning'
    ]);
    expect(items[0]).toEqual({
      label: 'Input',
      quantity: '2,406 tokens',
      rate: '$5 / 1M tokens',
      subtotal: 0.01203
    });
    expect(total(items)).toBeCloseTo(0.017736, 10);
    expect(usageSummary(row)).toBe('2,785 tokens');
  });

  it('bills a per-image price on the count, ignoring tokens', () => {
    const row = {
      capability: 'image' as const,
      imageCount: 1,
      inputTokens: 100,
      imagePrice: '0.02',
      inputPrice: '5'
    };
    expect(usageBreakdown(row)).toEqual([
      {
        label: 'Image',
        quantity: '1 image',
        rate: '$0.02 / image',
        subtotal: 0.02
      }
    ]);
    expect(usageSummary(row)).toBe('1 image');
  });

  it('bills a token-priced image on its tokens', () => {
    const items = usageBreakdown({
      capability: 'image',
      imageCount: 1,
      inputTokens: 416,
      outputTokens: 4000,
      inputPrice: '10',
      outputPrice: '40'
    });
    expect(items.map(i => i.label)).toEqual(['Input', 'Output']);
    expect(total(items)).toBeCloseTo(0.16416, 10);
    expect(
      usageSummary({
        capability: 'image',
        imageCount: 1,
        inputTokens: 416,
        outputTokens: 4000,
        inputPrice: '10'
      })
    ).toBe('1 image · 4,416 tokens');
  });

  it('bills video per clip when it has a clip price, else per second', () => {
    expect(
      usageBreakdown({
        capability: 'video',
        videoCount: 1,
        videoSeconds: '6.000',
        videoPrice: '0.5'
      })
    ).toEqual([
      {
        label: 'Video',
        quantity: '1 video',
        rate: '$0.5 / video',
        subtotal: 0.5
      }
    ]);
    const perSecond = {
      capability: 'video' as const,
      videoCount: 1,
      videoSeconds: '6.000',
      videoSecondsPrice: '0.1'
    };
    expect(usageBreakdown(perSecond)).toEqual([
      { label: 'Duration', quantity: '6 s', rate: '$0.1 / s', subtotal: 0.6 }
    ]);
    expect(usageSummary(perSecond)).toBe('6 s');
  });

  it('bills speech per character and transcription per second', () => {
    const speech = {
      capability: 'audio' as const,
      audioCharacters: 86,
      audioCharactersPrice: '15'
    };
    expect(usageBreakdown(speech)).toEqual([
      {
        label: 'Characters',
        quantity: '86 chars',
        rate: '$15 / 1M chars',
        subtotal: 0.00129
      }
    ]);
    expect(usageSummary(speech)).toBe('86 chars');

    const transcript = {
      capability: 'audio' as const,
      audioSeconds: '2.5',
      audioSecondsPrice: '0.000075'
    };
    expect(usageBreakdown(transcript)).toEqual([
      {
        label: 'Duration',
        quantity: '2.5 s',
        rate: '$0.000075 / s',
        subtotal: 0.0001875
      }
    ]);
    expect(usageSummary(transcript)).toBe('2.5 s');
  });
});
