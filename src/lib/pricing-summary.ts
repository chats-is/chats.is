import { formatUsd } from '@/lib/utils';

/** What a price row can carry. Every rate is optional: a model is priced on
 *  the dimensions it bills on, and on no others. */
export type PricingRates = {
  input?: string | null;
  output?: string | null;
  cacheRead?: string | null;
  cacheWrite?: string | null;
  reasoning?: string | null;
  image?: string | null;
  video?: string | null;
  videoSeconds?: string | null;
  audioInput?: string | null;
  audioOutput?: string | null;
  audioCharacters?: string | null;
  audioSeconds?: string | null;
};

/** Like `formatUsd` but returns `null` for unset values so callers can skip
 *  empty pricing lines (used by `summarizePricing`). */
const fmt = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)))
    return null;
  return formatUsd(v);
};

/**
 * Capability-aware list of pricing lines for the table. Each entry is
 * `"Label: $X"`; missing prices are omitted (no padding). Caller renders
 * the array one per line in the cell.
 *
 *   chat   → ["Input: $2.5", "Output: $15", "Cache Read: $0.25", "Cache Write: $0"]
 *   image  → ["Image: $0.04"]
 *   video  → ["Video: $0.5", "Per sec: $0.001"]
 *   audio  → ["Per 1M chars: $15"] or ["Input: $0.6", "Output: $12"]
 *
 * Token rates are per 1M tokens; image/video/per-sec are per unit.
 */

export function summarizePricing(
  capability: string,
  pricing: PricingRates | null | undefined
): string[] {
  if (!pricing) return [];
  const lines: string[] = [];
  // `unit` is the pricing basis suffix (e.g. /1M, /image) appended after the
  // dollar amount so each line reads like "Input: $10/1M".
  const push = (label: string, v: string | null | undefined, unit: string) => {
    const f = fmt(v);
    if (f) lines.push(`${label}: ${f}${unit}`);
  };
  switch (capability) {
    case 'chat': {
      push('Input', pricing.input, '/1M');
      push('Output', pricing.output, '/1M');
      push('Cache Read', pricing.cacheRead, '/1M');
      push('Cache Write', pricing.cacheWrite, '/1M');
      push('Reasoning', pricing.reasoning, '/1M');
      break;
    }
    case 'image': {
      // Per-image OR token-based (gpt-image-1) — show whichever is set.
      push('Image', pricing.image, '/image');
      push('Input', pricing.input, '/1M');
      push('Output', pricing.output, '/1M');
      break;
    }
    case 'video': {
      push('Video', pricing.video, '/video');
      push('Per sec', pricing.videoSeconds, '/s');
      break;
    }
    case 'audio': {
      // Per-character (TTS), token-based (TTS), or per-second (STT) — show
      // whichever is set.
      push('Per 1M chars', pricing.audioCharacters, '');
      push('Input', pricing.audioInput, '/1M');
      push('Output', pricing.audioOutput, '/1M');
      push('Per sec', pricing.audioSeconds, '/s');
      break;
    }
  }
  return lines;
}

/**
 * Whether this model has a price at all — a rate on any dimension it bills
 * on. Judged by what the pricing table itself would show, so a model that
 * reads as priced in one place reads as priced in the other.
 */
export function isPriced(
  capability: string,
  pricing: PricingRates | null | undefined
): boolean {
  return summarizePricing(capability, pricing).length > 0;
}
