import { type UsageRowLike } from '@/types';
import { effectiveMultiplier } from '@/lib/billing';
import { formatNumber, formatUsd, parseNumber } from '@/lib/utils';

/** One billed item of a usage row: how much, at what rate, for how much. */
export type UsageItem = {
  label: string;
  /** The quantity with its unit, e.g. "2,406 tokens" or "6 s". */
  quantity: string;
  /** The rate with its unit, e.g. "$5 / 1M tokens". */
  rate: string;
  subtotal: number;
};

const num = (v: string | number | null | undefined) => parseNumber(v) ?? 0;
const has = (v: string | null | undefined) => v != null && v !== '';
/** To the ten places a cost is stored with, as the cost engine rounds. */
const round = (n: number) => Math.round(n * 1e10) / 1e10;

const count = (n: number, one: string) =>
  `${formatNumber(n)} ${one}${n === 1 ? '' : 's'}`;

/**
 * What a usage row was billed for, item by item, from the quantities and the
 * rates stored on the row — so the items add up to its cost.
 *
 * Follows the cost engine's rules (`services/pricing.ts`): an image or video
 * priced per unit bills on the count alone, otherwise on its tokens or
 * seconds; a chat's reasoning rate is stored already resolved. An item with no
 * quantity is left out. Prices are the user's own — the cost price at their
 * tier's multiplier — so the items add up to what they spent.
 */
export function usageBreakdown(row: UsageRowLike): UsageItem[] {
  const items: UsageItem[] = [];
  // The rates on the row are cost prices; the user's price for each is the
  // rate times their tier's multiplier, and that is what is shown — the
  // price they used, with nothing left for the reader to work out.
  const multiplier = effectiveMultiplier(row.priceMultiplier);
  const priced = (price: string | null | undefined) =>
    price == null || price === '' ? null : num(price) * multiplier;
  /** Tokens or characters, priced per million. */
  const perMillion = (
    label: string,
    quantity: number,
    price: string | null | undefined,
    unit: 'token' | 'char'
  ) => {
    if (quantity <= 0) return;
    const rate = priced(price);
    items.push({
      label,
      quantity: count(quantity, unit),
      rate: `${formatUsd(rate)} / 1M ${unit}s`,
      subtotal: round((quantity * (rate ?? 0)) / 1_000_000)
    });
  };
  /** Images, videos or seconds, priced one by one. */
  const perUnit = (
    label: string,
    quantity: number,
    price: string | null | undefined,
    unit: 'image' | 'video' | 'search' | 's'
  ) => {
    if (quantity <= 0) return;
    const rate = priced(price);
    items.push({
      label,
      quantity:
        unit === 's' ? `${formatNumber(quantity)} s` : count(quantity, unit),
      rate: `${formatUsd(rate)} / ${unit}`,
      subtotal: round(quantity * (rate ?? 0))
    });
  };

  switch (row.capability) {
    case 'chat':
      perMillion('Input', num(row.inputTokens), row.inputPrice, 'token');
      perMillion(
        'Cache read',
        num(row.cacheReadTokens),
        row.cacheReadPrice,
        'token'
      );
      perMillion(
        'Cache write',
        num(row.cacheWriteTokens),
        row.cacheWritePrice,
        'token'
      );
      perMillion('Output', num(row.outputTokens), row.outputPrice, 'token');
      perMillion(
        'Reasoning',
        num(row.reasoningTokens),
        row.reasoningPrice,
        'token'
      );
      perUnit('Web search', num(row.webSearches), row.webSearchPrice, 'search');
      break;
    case 'image':
      if (num(row.imagePrice) > 0) {
        perUnit('Image', num(row.imageCount), row.imagePrice, 'image');
      } else {
        perMillion('Input', num(row.inputTokens), row.inputPrice, 'token');
        perMillion('Output', num(row.outputTokens), row.outputPrice, 'token');
      }
      break;
    case 'video':
      if (num(row.videoPrice) > 0) {
        perUnit('Video', num(row.videoCount), row.videoPrice, 'video');
      } else {
        perUnit('Duration', num(row.videoSeconds), row.videoSecondsPrice, 's');
      }
      break;
    case 'audio':
      if (num(row.audioCharacters) > 0 || has(row.audioCharactersPrice)) {
        perMillion(
          'Characters',
          num(row.audioCharacters),
          row.audioCharactersPrice,
          'char'
        );
      }
      perUnit('Duration', num(row.audioSeconds), row.audioSecondsPrice, 's');
      break;
  }
  return items;
}

/**
 * A usage row's quantity in one phrase, for the log's own row: the tokens a
 * chat used in all — the sum of its items — or the images, seconds or
 * characters a media call produced.
 */
export function usageSummary(row: UsageRowLike): string {
  switch (row.capability) {
    case 'chat':
      return count(
        num(row.inputTokens) +
          num(row.cacheReadTokens) +
          num(row.cacheWriteTokens) +
          num(row.outputTokens) +
          num(row.reasoningTokens),
        'token'
      );
    case 'image': {
      // Billed on tokens, it says so, so the items beneath add up to it.
      const tokens = num(row.inputTokens) + num(row.outputTokens);
      const images = count(num(row.imageCount), 'image');
      return num(row.imagePrice) > 0 || tokens === 0
        ? images
        : `${images} · ${count(tokens, 'token')}`;
    }
    case 'video':
      return num(row.videoSeconds) > 0
        ? `${formatNumber(num(row.videoSeconds))} s`
        : count(num(row.videoCount), 'video');
    case 'audio':
      return num(row.audioCharacters) > 0
        ? count(num(row.audioCharacters), 'char')
        : `${formatNumber(num(row.audioSeconds))} s`;
  }
}
