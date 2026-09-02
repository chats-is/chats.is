import type { UsageRowLike } from '@/types';
import { parseNumber } from '@/lib/utils';

/**
 * Capability-aware "Unit Price" cell for usage log tables. Returns a single
 * `<td>` (must be used directly inside `<tr>`).
 *
 * Shows the per-unit rate snapshot stored on each usage row — the rate that
 * was actually applied at compute time, so the Cost column is auditable.
 * Layout mirrors `UsageQuantity`: chat uses two lines, others a single line.
 * Token rates are per 1M tokens; image/video/audio rates are per unit.
 */

const has = (v: string | null | undefined): boolean =>
  v !== null && v !== undefined && v !== '';

/** Token rate, stored per 1M tokens. */
const per1M = (v: string | null | undefined): string =>
  `$${parseNumber(v) ?? 0}/1M`;
/** Per-unit rate (image / video / second). */
const perUnit = (v: string | null | undefined, unit: string): string =>
  `$${parseNumber(v) ?? 0}/${unit}`;

export function UsageUnitPrice({ row }: { row: UsageRowLike }) {
  if (row.capability === 'chat') {
    const top: Pair[] = [];
    if (has(row.inputPrice))
      top.push({ label: 'Input', value: per1M(row.inputPrice) });
    if (has(row.outputPrice))
      top.push({ label: 'Output', value: per1M(row.outputPrice) });
    if (has(row.reasoningPrice))
      top.push({ label: 'Reasoning', value: per1M(row.reasoningPrice) });

    const bottom: Pair[] = [];
    if (has(row.cacheReadPrice))
      bottom.push({ label: 'Cache Read', value: per1M(row.cacheReadPrice) });
    if (has(row.cacheWritePrice))
      bottom.push({ label: 'Cache Write', value: per1M(row.cacheWritePrice) });

    return (
      <td className="p-2 text-left align-middle font-mono text-xs">
        {top.length > 0 && <div>{renderPairs(top)}</div>}
        {bottom.length > 0 && <div>{renderPairs(bottom)}</div>}
        {top.length === 0 && bottom.length === 0 && '—'}
      </td>
    );
  }

  if (row.capability === 'image') {
    // Per-image model → per-image rate; token-billed model → input/output.
    const items: Pair[] = [];
    if (has(row.imagePrice)) {
      items.push({ label: 'Image', value: perUnit(row.imagePrice, 'image') });
    } else {
      if (has(row.inputPrice))
        items.push({ label: 'Input', value: per1M(row.inputPrice) });
      if (has(row.outputPrice))
        items.push({ label: 'Output', value: per1M(row.outputPrice) });
    }
    return (
      <td className="p-2 text-left font-mono text-xs">
        {items.length ? renderPairs(items) : '—'}
      </td>
    );
  }

  if (row.capability === 'video') {
    const items: Pair[] = [];
    if (has(row.videoPrice))
      items.push({ label: 'Video', value: perUnit(row.videoPrice, 'video') });
    if (has(row.videoSecondsPrice))
      items.push({
        label: 'Per sec',
        value: perUnit(row.videoSecondsPrice, 's')
      });
    return (
      <td className="p-2 text-left font-mono text-xs">
        {items.length ? renderPairs(items) : '—'}
      </td>
    );
  }

  // audio — per-character (classic TTS) or per-token (gpt-4o-mini-tts, omni)
  const items: Pair[] = [];
  if (has(row.audioCharactersPrice)) {
    items.push({ label: 'Chars', value: per1M(row.audioCharactersPrice) });
  } else {
    if (has(row.audioInputPrice))
      items.push({ label: 'In', value: per1M(row.audioInputPrice) });
    if (has(row.audioOutputPrice))
      items.push({ label: 'Out', value: per1M(row.audioOutputPrice) });
  }
  return (
    <td className="p-2 text-left font-mono text-xs">
      {items.length ? renderPairs(items) : '—'}
    </td>
  );
}

type Pair = { label: string; value: string };

/** Render label-value pairs joined by " / " separator. Label and separator
 *  muted, value gets default foreground for contrast. */
function renderPairs(pairs: Pair[]): React.ReactNode {
  return pairs.map((p, i) => (
    <span key={p.label}>
      {i > 0 && <span className="text-muted-foreground"> / </span>}
      <span className="text-muted-foreground">{p.label} </span>
      <span>{p.value}</span>
    </span>
  ));
}
