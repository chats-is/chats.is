import { describe, expect, it } from 'vitest'

import { normalizeChatUsage } from './chat-usage'

describe('normalizeChatUsage', () => {
  it('reads disjoint buckets from inputTokenDetails / outputTokenDetails', () => {
    // The SDK already decomposes usage; we consume it directly.
    const out = normalizeChatUsage({
      inputTokens: 3_500_000, // total = noCache + cacheRead + cacheWrite
      outputTokens: 1_000_000, // total = text + reasoning
      inputTokenDetails: {
        noCacheTokens: 1_000_000,
        cacheReadTokens: 2_000_000,
        cacheWriteTokens: 500_000,
      },
      outputTokenDetails: { textTokens: 600_000, reasoningTokens: 400_000 },
    })
    expect(out).toEqual({
      inputTokens: 1_000_000,
      outputTokens: 600_000,
      cacheReadTokens: 2_000_000,
      cacheWriteTokens: 500_000,
      reasoningTokens: 400_000,
    })
    // Buckets reconstruct the provider totals.
    expect(
      out.inputTokens! + out.cacheReadTokens! + out.cacheWriteTokens!,
    ).toBe(3_500_000)
    expect(out.outputTokens! + out.reasoningTokens!).toBe(1_000_000)
  })

  it('captures cache-write for any provider, not just Anthropic (Bedrock regression)', () => {
    // Bedrock reports cacheWrite via inputTokenDetails.cacheWriteTokens. It must
    // be its own bucket (billed at the cache-write rate), NOT folded into input.
    const out = normalizeChatUsage({
      inputTokens: 1_500_000,
      outputTokens: 0,
      inputTokenDetails: {
        noCacheTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 500_000,
      },
    })
    expect(out.inputTokens).toBe(1_000_000) // plain input only
    expect(out.cacheWriteTokens).toBe(500_000)
  })

  it('falls back to deprecated flat fields + subtraction when details are absent', () => {
    // Older/minimal usage shape: no *TokenDetails, only totals + deprecated aliases.
    const out = normalizeChatUsage({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cachedInputTokens: 400_000, // deprecated alias for cacheRead
      reasoningTokens: 300_000, // deprecated alias
    })
    expect(out).toEqual({
      inputTokens: 600_000, // 1M - 400k cacheRead - 0 cacheWrite
      outputTokens: 700_000, // 1M - 300k reasoning
      cacheReadTokens: 400_000,
      cacheWriteTokens: 0,
      reasoningTokens: 300_000,
    })
  })

  it('is a no-op for plain usage (no cache, no reasoning)', () => {
    const out = normalizeChatUsage({
      inputTokens: 1000,
      outputTokens: 500,
      inputTokenDetails: {
        noCacheTokens: 1000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      outputTokenDetails: { textTokens: 500, reasoningTokens: 0 },
    })
    expect(out).toEqual({
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    })
  })

  it('clamps derived buckets to 0 when sub-counts exceed the total (defensive fallback)', () => {
    const out = normalizeChatUsage({
      inputTokens: 100,
      outputTokens: 100,
      cachedInputTokens: 500, // deprecated path → derive plainInput, clamp at 0
    })
    expect(out.inputTokens).toBe(0)
    expect(out.outputTokens).toBe(100)
  })

  it('handles missing token fields as 0', () => {
    expect(normalizeChatUsage({})).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    })
  })
})
