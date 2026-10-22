import { Link } from '@tanstack/react-router';
import { Check, Copy, ExternalLink } from 'lucide-react';

import { type ProviderRequest } from '@/types';
import { effectiveMultiplier } from '@/lib/billing';
import { usageBreakdown, usageSummary } from '@/lib/usage-breakdown';
import { cn, formatUsd } from '@/lib/utils';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { type adminUsageLog } from '@/server/functions/usage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { createAppColumnHelper } from '@/components/console/data-table';
import { LocalTime } from '@/components/local-time';

/**
 * The usage log, as the console shows it wherever it shows one: a line per
 * call, opening onto what that call was billed for. The Logs list
 * everyone's; a user's page lists theirs, without the user column.
 */

export type UsageLogRow = Awaited<
  ReturnType<typeof adminUsageLog>
>['rows'][number];

const helper = createAppColumnHelper<UsageLogRow>();

/** The log's columns: with a user column when the log is everyone's, and
 *  with the model as a filter when the page can filter by it. */
export const usageLogColumns = ({
  withUser,
  onModelClick
}: {
  withUser: boolean;
  onModelClick?: (modelId: string) => void;
}) =>
  helper.columns([
    helper.accessor('createdAt', {
      header: 'Created',
      meta: {
        headClassName: 'w-52',
        cellClassName: 'text-xs whitespace-nowrap text-muted-foreground'
      },
      cell: ({ row }) => <LocalTime value={row.original.createdAt} />
    }),
    ...(withUser ? [userColumn] : []),
    helper.accessor('modelId', {
      header: 'Model',
      meta: { headClassName: 'w-96' },
      // One line: the model asked for — a filter, where the page has one — the id the provider was actually asked
      // for when routed, what kind of call it was, and the tier its prices
      // are at. A tier since deleted is named by its multiplier, which the
      // row kept.
      cell: ({ row }) => (
        <div className="flex items-center gap-2 font-mono text-xs whitespace-nowrap">
          {onModelClick && row.original.modelId ? (
            <button
              type="button"
              title="Show only this model"
              onClick={() => onModelClick(row.original.modelId ?? '')}
              className="underline-offset-4 hover:text-primary hover:underline"
            >
              {row.original.modelId}
            </button>
          ) : (
            <span>{row.original.modelId ?? '—'}</span>
          )}
          {row.original.providerModelId &&
            row.original.providerModelId !== row.original.modelId && (
              <span className="text-muted-foreground">
                → {row.original.providerModelId}
              </span>
            )}
          <Badge variant="secondary" className="font-sans">
            {row.original.capability}
          </Badge>
          {tierLabel(row.original) && (
            <Badge variant="secondary" className="font-sans">
              {tierLabel(row.original)}
            </Badge>
          )}
        </div>
      )
    }),
    helper.display({
      id: 'usage',
      header: 'Usage',
      meta: { align: 'right', cellClassName: 'whitespace-nowrap tabular-nums' },
      cell: ({ row }) => usageSummary(row.original)
    }),
    helper.accessor('cost', {
      header: 'Cost',
      meta: {
        align: 'right',
        headClassName: 'w-36',
        cellClassName: 'font-mono whitespace-nowrap text-muted-foreground'
      },
      cell: ({ row }) => formatUsd(row.original.cost)
    }),
    helper.accessor('spend', {
      header: 'Spend',
      meta: {
        align: 'right',
        headClassName: 'w-36',
        cellClassName: 'font-mono whitespace-nowrap'
      },
      cell: ({ row }) => formatUsd(row.original.spend)
    })
  ]);

/** The tier a row's prices are at, as a badge: "Tier2 ×1.5". A tier since
 *  deleted is named by its multiplier alone; no tier, nothing. */
function tierLabel(row: UsageLogRow): string | null {
  const multiplier = effectiveMultiplier(row.priceMultiplier);
  if (row.tierName) return `${row.tierName} ×${multiplier}`;
  return multiplier !== 1 ? `×${multiplier}` : null;
}

const userColumn = helper.accessor('userName', {
  header: 'User',
  meta: { headClassName: 'w-48', cellClassName: 'max-w-48' },
  // The name alone keeps the row to one line; an account with no name goes
  // by its address.
  cell: ({ row }) => (
    <Link
      to="/console/users/$userId"
      params={{ userId: row.original.userId }}
      title={row.original.userEmail ?? undefined}
      // Only the name and its icon open the user: the rest of the cell
      // belongs to the row, which opens on a click.
      className="group inline-flex max-w-full items-center gap-1 font-medium hover:text-primary"
    >
      <span className="truncate underline-offset-4 group-hover:underline">
        {row.original.userName || row.original.userEmail || 'Unknown'}
      </span>
      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
    </Link>
  )
});

/**
 * What a record was billed for, a row per item under the record's own
 * columns: the item and its rate under Model, how much of it under Usage, what
 * it came to under Spend — so the quantities add up to the record's usage and
 * the subtotals to its spend, each right beneath the figure it makes up.
 */
export function UsageItems({
  row,
  withUser
}: {
  row: UsageLogRow;
  /** Matches the columns: without a user column, the provider goes under the
   *  time, past the chevron. */
  withUser: boolean;
}) {
  const items = usageBreakdown(row);
  const cell = 'px-2 py-1.5 text-xs';
  // The record's own id, under its time: what a provider was sent with the
  // call. Unnamed, every row here being a usage record.
  const usageId = <CopyableId label="Usage ID" value={row.id} compact />;
  const via = <>via {row.providerName ?? 'an unknown provider'}</>;
  // Each call's ids at its provider, on a line of their own after the items.
  const requests = row.providerRequests ?? [];
  const lineCount = Math.max(items.length, 1) + (requests.length > 0 ? 1 : 0);
  // The cells before a line's own: on the first, the id under the time and
  // the provider under the user. Without a user column both go under the
  // time, the id on the line after the provider's — or beneath it, where
  // there is no other line.
  const lead = (line: number) =>
    withUser ? (
      <>
        <TableCell className={cn(cell, 'pl-8')}>
          {line === 0 && usageId}
        </TableCell>
        <TableCell className={cn(cell, 'text-muted-foreground')}>
          {line === 0 && via}
        </TableCell>
      </>
    ) : (
      <TableCell className={cn(cell, 'pl-8 text-muted-foreground')}>
        {line === 0 && via}
        {(line === 1 || lineCount === 1) && usageId}
      </TableCell>
    );

  // What to search the provider's logs for.
  const ids = requests.length > 0 && (
    <TableRow className="hover:bg-muted/30">
      {lead(lineCount - 1)}
      <TableCell colSpan={3} className={cn(cell, 'space-y-2')}>
        {requests.map((request, index) => (
          <ProviderRequestIds key={index} request={request} />
        ))}
      </TableCell>
    </TableRow>
  );

  if (items.length === 0) {
    return (
      <>
        <TableRow
          className={cn('border-b hover:bg-muted/30', ids && 'border-b-0')}
        >
          {lead(0)}
          <TableCell colSpan={3} className={cn(cell, 'text-muted-foreground')}>
            No rate was recorded for this call, so nothing was billed.
          </TableCell>
        </TableRow>
        {ids}
      </>
    );
  }

  // The items are at the user's own prices, and add up to the spend.
  const lines = items.map((item, index) => (
    <TableRow
      key={item.label}
      className={cn(
        'hover:bg-muted/30',
        (index < items.length - 1 || ids) && 'border-b-0'
      )}
    >
      {lead(index)}
      <TableCell className={cell}>
        <span className="inline-block w-24">{item.label}</span>
        <span className="font-mono text-muted-foreground">{item.rate}</span>
      </TableCell>
      <TableCell className={cn(cell, 'text-right tabular-nums')}>
        {item.quantity}
      </TableCell>
      <TableCell className={cn(cell, 'text-right font-mono')}>
        {formatUsd(item.subtotal)}
      </TableCell>
    </TableRow>
  ));
  return (
    <>
      {lines}
      {ids}
    </>
  );
}

/** One call's ids at its provider, each to copy, in the order they arrive:
 *  the request's in the headers, then the response's. A response id that
 *  only repeats the request's, as xAI's does, is shown once. */
function ProviderRequestIds({ request }: { request: ProviderRequest }) {
  return (
    <div>
      {request.requestId && (
        <CopyableId label="Request ID" value={request.requestId} />
      )}
      {request.responseId && request.responseId !== request.requestId && (
        <CopyableId label="Response ID" value={request.responseId} />
      )}
    </div>
  );
}

/** An id to copy, named beside it — or, `compact`, cut to its start and
 *  named only to a screen reader, where its place says what it is. The whole
 *  id is what is copied either way. */
function CopyableId({
  label,
  value,
  compact = false
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  return (
    <div className="flex items-center">
      {!compact && <span className="inline-block w-24 shrink-0">{label}</span>}
      <span
        className="font-mono break-all text-muted-foreground"
        title={compact ? value : undefined}
      >
        {compact ? `${value.slice(0, 8)}…` : value}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            // Compact, it shares a line with an item and must not make the
            // line taller than the item's own.
            className={cn(
              'ml-1 size-6 shrink-0 text-muted-foreground',
              compact && '-my-1'
            )}
            onClick={() => copyToClipboard(value)}
            aria-label={`Copy ${label}`}
          >
            {isCopied ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isCopied ? 'Copied' : 'Copy'}</TooltipContent>
      </Tooltip>
    </div>
  );
}
