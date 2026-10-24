import { formatUsd } from '@/lib/utils';

/** What a price row can carry. Every rate is optional: a model is priced on
 *  the dimensions it bills on, and on no others. */
export type PricingRates = {
  input?: string | null;
  output?: string | null;
  cacheRead?: string | null;
  cacheWrite?: string | null;
  reasoning?: string | null;
  webSearch?: string | null;
  xPost?: string | null;
  xProfile?: string | null;
  image?: string | null;
  imageInput?: string | null;
  imageOutput?: string | null;
  video?: string | null;
  videoSeconds?: string | null;
  audioInput?: string | null;
  audioOutput?: string | null;
  audioCharacters?: string | null;
  audioMinute?: string | null;
};

/** Like `formatUsd` but returns `null` for unset values so callers can skip
 *  empty pricing lines (used by `summarizePricingRows`). */
const fmt = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)))
    return null;
  return formatUsd(v);
};

/**
 * Capability-aware pricing lines for the table, in rows: what the model is
 * billed for on every call first — an image or audio model's words, then its
 * pictures or audio — then the cache rates and the search rates, which apply
 * only to some calls, each on a row of its own. Each entry is
 * `"Label: $X/unit"`; a rate that is not set is left out, and so is a row
 * with nothing in it.
 *
 *   chat   → [["Input: $2.5/1M", "Output: $15/1M", "Reasoning: $15/1M"],
 *             ["Cache Read: $0.25/1M", "Cache Write: $0/1M"],
 *             ["Web Search: $10/1K", "X Posts: $5/1K", "X Profiles: $10/1K"]]
 *   image  → [["Image: $0.04/image"]] or
 *             [["Input: $5/1M", "Output: $10/1M"],
 *              ["Image Input: $8/1M", "Image Output: $32/1M"]]
 *   video  → [["Video: $0.5/video", "Per sec: $0.001/s"]]
 *   audio  → [["Per 1M chars: $15"]], [["Per min: $0.006/min"]] or
 *             [["Input: $0.5/1M"], ["Audio Output: $10/1M"]]
 *
 * Token rates are per 1M tokens, searches and X posts or profiles per 1K;
 * image/video/per-sec are per unit, and transcription per minute.
 */
export function summarizePricingRows(
  capability: string,
  pricing: PricingRates | null | undefined
): string[][] {
  if (!pricing) return [];
  const main: string[] = [];
  // An image or audio model's pictures or audio, apart from its words.
  const media: string[] = [];
  const cache: string[] = [];
  const search: string[] = [];
  // `unit` is the pricing basis suffix (e.g. /1M, /image) appended after the
  // dollar amount so each line reads like "Input: $10/1M".
  const push = (
    row: string[],
    label: string,
    v: string | null | undefined,
    unit: string
  ) => {
    const f = fmt(v);
    if (f) row.push(`${label}: ${f}${unit}`);
  };
  switch (capability) {
    case 'chat': {
      push(main, 'Input', pricing.input, '/1M');
      push(main, 'Output', pricing.output, '/1M');
      push(main, 'Reasoning', pricing.reasoning, '/1M');
      push(cache, 'Cache Read', pricing.cacheRead, '/1M');
      push(cache, 'Cache Write', pricing.cacheWrite, '/1M');
      push(search, 'Web Search', pricing.webSearch, '/1K');
      push(search, 'X Posts', pricing.xPost, '/1K');
      push(search, 'X Profiles', pricing.xProfile, '/1K');
      break;
    }
    case 'image': {
      // Per-image OR token-based (gpt-image-1) — show whichever is set.
      push(main, 'Image', pricing.image, '/image');
      push(main, 'Input', pricing.input, '/1M');
      push(main, 'Output', pricing.output, '/1M');
      push(media, 'Image Input', pricing.imageInput, '/1M');
      push(media, 'Image Output', pricing.imageOutput, '/1M');
      break;
    }
    case 'video': {
      push(main, 'Video', pricing.video, '/video');
      push(main, 'Per sec', pricing.videoSeconds, '/s');
      break;
    }
    case 'audio': {
      // Per-character (TTS), per-minute (STT), or token-based — the words,
      // then the audio — show whichever is set.
      push(main, 'Per 1M chars', pricing.audioCharacters, '');
      push(main, 'Per min', pricing.audioMinute, '/min');
      push(main, 'Input', pricing.input, '/1M');
      push(main, 'Output', pricing.output, '/1M');
      push(media, 'Audio Input', pricing.audioInput, '/1M');
      push(media, 'Audio Output', pricing.audioOutput, '/1M');
      break;
    }
  }
  return [main, media, cache, search].filter(row => row.length > 0);
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
  return summarizePricingRows(capability, pricing).length > 0;
}
