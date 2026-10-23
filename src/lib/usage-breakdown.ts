import { type UsageRowLike } from '@/types';
import { effectiveMultiplier } from '@/lib/billing';
import { formatCount, formatNumber, formatUsd, parseNumber } from '@/lib/utils';

/** Every token a day's or a window's calls used. The buckets are stored
 *  apart — input is the uncached part only, output the text only (see
 *  normalizeChatUsage) — so the total is their sum, and matches what the
 *  usage log counts per row. */
export function tokensOf(t: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
}) {
  return (
    t.inputTokens +
    t.cacheReadTokens +
    t.cacheWriteTokens +
    t.outputTokens +
    t.reasoningTokens
  );
}

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
      quantity: formatCount(quantity, unit),
      rate: `${formatUsd(rate)} / 1M ${unit}s`,
      subtotal: round((quantity * (rate ?? 0)) / 1_000_000)
    });
  };
  /** Searches, or what a search of X fetched, priced per thousand as
   *  providers quote them. */
  const perThousand = (
    label: string,
    quantity: number,
    price: string | null | undefined,
    unit: 'search' | 'post' | 'profile'
  ) => {
    if (quantity <= 0) return;
    const rate = priced(price);
    const units = unit === 'search' ? 'searches' : `${unit}s`;
    items.push({
      label,
      quantity: `${formatNumber(quantity)} ${quantity === 1 ? unit : units}`,
      rate: `${formatUsd(rate)} / 1K ${units}`,
      subtotal: round((quantity * (rate ?? 0)) / 1_000)
    });
  };
  /** Images, videos or seconds, priced one by one. */
  const perUnit = (
    label: string,
    quantity: number,
    price: string | null | undefined,
    unit: 'image' | 'video' | 's'
  ) => {
    if (quantity <= 0) return;
    const rate = priced(price);
    items.push({
      label,
      quantity:
        unit === 's'
          ? `${formatNumber(quantity)} s`
          : formatCount(quantity, unit),
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
      perThousand(
        'Web search',
        num(row.webSearches),
        row.webSearchPrice,
        'search'
      );
      perThousand('X posts', num(row.xPosts), row.xPostPrice, 'post');
      perThousand(
        'X profiles',
        num(row.xProfiles),
        row.xProfilePrice,
        'profile'
      );
      break;
    case 'image':
      if (num(row.imagePrice) > 0) {
        perUnit('Image', num(row.imageCount), row.imagePrice, 'image');
      } else {
        // The pictures read and drawn apart from the words, each at its rate.
        const imageInput = num(row.imageInputTokens);
        const imageOutput = num(row.imageOutputTokens);
        perMillion(
          'Input',
          num(row.inputTokens) - imageInput,
          row.inputPrice,
          'token'
        );
        perMillion(
          'Output',
          num(row.outputTokens) - imageOutput,
          row.outputPrice,
          'token'
        );
        perMillion('Image input', imageInput, row.imageInputPrice, 'token');
        perMillion('Image output', imageOutput, row.imageOutputPrice, 'token');
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
      // Heard for so many seconds, priced per minute.
      if (num(row.audioSeconds) > 0) {
        const rate = priced(row.audioMinutePrice);
        items.push({
          label: 'Duration',
          quantity: `${formatNumber(num(row.audioSeconds))} s`,
          rate: `${formatUsd(rate)} / min`,
          subtotal: round((num(row.audioSeconds) / 60) * (rate ?? 0))
        });
      }
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
      return formatCount(
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
      const images = formatCount(num(row.imageCount), 'image');
      return num(row.imagePrice) > 0 || tokens === 0
        ? images
        : `${images} · ${formatCount(tokens, 'token')}`;
    }
    case 'video':
      return num(row.videoSeconds) > 0
        ? `${formatNumber(num(row.videoSeconds))} s`
        : formatCount(num(row.videoCount), 'video');
    case 'audio':
      return num(row.audioCharacters) > 0
        ? formatCount(num(row.audioCharacters), 'char')
        : `${formatNumber(num(row.audioSeconds))} s`;
  }
}
