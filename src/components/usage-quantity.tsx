import type { UsageRowLike } from '@/types';
import { formatNumber, parseNumber } from '@/lib/utils';

/**
 * Capability-aware "Quantity" cell for usage log tables. Returns a single
 * `<td>` (must be used directly inside `<tr>`).
 *
 * Layouts:
 *   chat   → two lines inside one cell, " / " separated, label muted + value normal:
 *              Input N / Output N / Reasoning N
 *              Cache Read N / Cache Write N
 *            Only non-zero values are shown; if a group is fully empty its
 *            line is omitted.
 *   image / video / audio → single line summary.
 */

export function UsageQuantity({ row }: { row: UsageRowLike }) {
  if (row.capability === 'chat') {
    const i = parseNumber(row.inputTokens) ?? 0;
    const o = parseNumber(row.outputTokens) ?? 0;
    const cR = parseNumber(row.cacheReadTokens) ?? 0;
    const cW = parseNumber(row.cacheWriteTokens) ?? 0;
    const reason = parseNumber(row.reasoningTokens) ?? 0;

    const top: Pair[] = [];
    if (i > 0) top.push({ label: 'Input', value: formatNumber(i) });
    if (o > 0) top.push({ label: 'Output', value: formatNumber(o) });
    if (reason > 0)
      top.push({ label: 'Reasoning', value: formatNumber(reason) });

    const bottom: Pair[] = [];
    if (cR > 0) bottom.push({ label: 'Cache Read', value: formatNumber(cR) });
    if (cW > 0) bottom.push({ label: 'Cache Write', value: formatNumber(cW) });

    return (
      <td className="p-2 text-left align-middle font-mono text-xs">
        {top.length > 0 && <div>{renderPairs(top)}</div>}
        {bottom.length > 0 && <div>{renderPairs(bottom)}</div>}
        {top.length === 0 && bottom.length === 0 && '—'}
      </td>
    );
  }

  if (row.capability === 'image') {
    // Token-billed image models (e.g. gpt-image-1) bill by tokens, not per
    // image — show token counts so Quantity lines up with the per-1M Unit
    // Price. Per-image models show the image count.
    const tokenBilled =
      row.imagePrice == null &&
      ((parseNumber(row.inputTokens) ?? 0) > 0 ||
        (parseNumber(row.outputTokens) ?? 0) > 0);

    if (tokenBilled) {
      const items: Pair[] = [];
      const i = parseNumber(row.inputTokens) ?? 0;
      const o = parseNumber(row.outputTokens) ?? 0;
      if (i > 0) items.push({ label: 'Input', value: formatNumber(i) });
      if (o > 0) items.push({ label: 'Output', value: formatNumber(o) });
      return (
        <td className="p-2 text-left align-middle font-mono text-xs">
          {renderPairs(items)}
        </td>
      );
    }

    const n = parseNumber(row.imageCount) ?? 0;
    return (
      <td className="p-2 text-left font-mono text-xs">
        {n ? (
          <>
            <span>{formatNumber(n)}</span>
            <span className="text-muted-foreground">
              {' '}
              image{n > 1 ? 's' : ''}
            </span>
          </>
        ) : (
          '—'
        )}
      </td>
    );
  }

  if (row.capability === 'video') {
    const c = parseNumber(row.videoCount) ?? 0;
    const s = parseNumber(row.videoSeconds) ?? 0;
    const items: React.ReactNode[] = [];
    if (c)
      items.push(
        <>
          <span>{formatNumber(c)}</span>
          <span className="text-muted-foreground">
            {' '}
            video{c > 1 ? 's' : ''}
          </span>
        </>
      );
    if (s)
      items.push(
        <>
          <span>{s.toFixed(1)}</span>
          <span className="text-muted-foreground"> s</span>
        </>
      );
    return (
      <td className="p-2 text-left font-mono text-xs">
        {items.length ? joinWithSep(items) : '—'}
      </td>
    );
  }

  // audio — per-character (classic TTS) or per-token (gpt-4o-mini-tts, omni)
  const chars = parseNumber(row.audioCharacters) ?? 0;
  const ai = parseNumber(row.audioInputTokens) ?? 0;
  const ao = parseNumber(row.audioOutputTokens) ?? 0;
  const items: React.ReactNode[] = [];
  if (chars)
    items.push(
      <>
        <span>{formatNumber(chars)}</span>
        <span className="text-muted-foreground"> chars</span>
      </>
    );
  if (ai)
    items.push(
      <>
        <span>{formatNumber(ai)}</span>
        <span className="text-muted-foreground"> in</span>
      </>
    );
  if (ao)
    items.push(
      <>
        <span>{formatNumber(ao)}</span>
        <span className="text-muted-foreground"> out</span>
      </>
    );
  return (
    <td className="p-2 text-left font-mono text-xs">
      {items.length ? joinWithSep(items) : '—'}
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

/** Join an array of ReactNodes with " / " separator (muted). */
function joinWithSep(items: React.ReactNode[]): React.ReactNode {
  return items.map((item, i) => (
    <span key={i}>
      {i > 0 && <span className="text-muted-foreground"> / </span>}
      {item}
    </span>
  ));
}
