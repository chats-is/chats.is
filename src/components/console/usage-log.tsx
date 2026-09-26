import { Link } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';

import { describeMultiplier, effectiveMultiplier } from '@/lib/billing';
import { usageBreakdown, usageSummary } from '@/lib/usage-breakdown';
import { cn, formatUsd } from '@/lib/utils';
import { type adminUsageLog } from '@/server/functions/usage';
import { Badge } from '@/components/ui/badge';
import { TableCell, TableRow } from '@/components/ui/table';
import { createAppColumnHelper } from '@/components/console/data-table';

/**
 * The usage log, as the console shows it wherever it shows one: a line per
 * call, opening onto what that call was billed for. The usage page lists
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
      header: 'Time',
      meta: {
        headClassName: 'w-52',
        cellClassName: 'text-xs whitespace-nowrap text-muted-foreground'
      },
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleString()
    }),
    ...(withUser ? [userColumn] : []),
    helper.accessor('modelId', {
      header: 'Model',
      meta: { headClassName: 'w-96' },
      // One line: the model asked for — a filter, where the page has one — the id the provider was actually asked
      // for when routed, and what kind of call it was.
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
        </div>
      )
    }),
    helper.display({
      id: 'usage',
      header: 'Usage',
      meta: { align: 'right', cellClassName: 'whitespace-nowrap tabular-nums' },
      cell: ({ row }) => usageSummary(row.original)
    }),
    helper.accessor('spend', {
      header: 'Spend',
      meta: {
        align: 'right',
        headClassName: 'w-36',
        cellClassName: 'font-mono whitespace-nowrap'
      },
      cell: ({ row }) => formatUsd(row.original.spend)
    }),
    helper.accessor('cost', {
      header: 'Cost',
      meta: {
        align: 'right',
        headClassName: 'w-36',
        cellClassName: 'font-mono whitespace-nowrap text-muted-foreground'
      },
      cell: ({ row }) => formatUsd(row.original.cost)
    })
  ]);

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
  // Who served the call, and the tier its prices are at — its name and its
  // multiplier as it then stood. A tier since deleted keeps the multiplier.
  const multiplier = effectiveMultiplier(row.priceMultiplier);
  const tier = row.tierName
    ? `${row.tierName} × ${multiplier}`
    : multiplier !== 1
      ? describeMultiplier(row.priceMultiplier)
      : null;
  const provider = (
    <TableCell
      className={cn(cell, 'text-muted-foreground', !withUser && 'pl-8')}
    >
      via {row.providerName ?? 'an unknown provider'}
      {tier && ` · ${tier}`}
    </TableCell>
  );
  // The cells before the item's own: time, then user when there is one.
  const lead = (first: boolean) =>
    withUser ? (
      <>
        <TableCell className={cell} />
        {first ? provider : <TableCell className={cell} />}
      </>
    ) : first ? (
      provider
    ) : (
      <TableCell className={cell} />
    );

  if (items.length === 0) {
    return (
      <TableRow className="border-b hover:bg-muted/30">
        {lead(true)}
        <TableCell colSpan={3} className={cn(cell, 'text-muted-foreground')}>
          No rate was recorded for this call, so nothing was billed.
        </TableCell>
      </TableRow>
    );
  }

  // The items are at the user's own prices, and add up to the spend.
  return items.map((item, index) => (
    <TableRow
      key={item.label}
      className={cn(
        'hover:bg-muted/30',
        index < items.length - 1 && 'border-b-0'
      )}
    >
      {lead(index === 0)}
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
}
