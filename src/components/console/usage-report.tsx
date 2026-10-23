import { useMemo, useState } from 'react';

import { USAGE_GROUPINGS } from '@/lib/constant';
import { formatNumber, formatUsd } from '@/lib/utils';
import { type adminUsageStats } from '@/server/functions/usage';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Amount } from '@/components/console/amount';
import {
  DailyUsageChart,
  groupTotals,
  mediaText,
  totalOf
} from '@/components/console/daily-usage-chart';
import {
  createAppColumnHelper,
  DataTable
} from '@/components/console/data-table';
import { ChartSkeleton } from '@/components/console/skeletons';
import { UsageTotals } from '@/components/console/usage-totals';

type UsageStats = Awaited<ReturnType<typeof adminUsageStats>>;
type Grouping = (typeof USAGE_GROUPINGS)[number]['id'];
type Figures = ReturnType<typeof totalOf>;

/** A line of the table: a model, provider or capability, or their total. */
type DetailRow = {
  id: string;
  label: string;
  /** The row that adds the others up. */
  total: boolean;
  figures: Figures;
};

/** Each kind of token, as the table heads its column. */
const TOKEN_COLUMNS = [
  { key: 'inputTokens', header: 'Input' },
  { key: 'outputTokens', header: 'Output' },
  { key: 'reasoningTokens', header: 'Reasoning' },
  { key: 'cacheReadTokens', header: 'Cache read' },
  { key: 'cacheWriteTokens', header: 'Cache write' }
] as const;

const detailHelper = createAppColumnHelper<DetailRow>();

/** A count, to the right. */
const count = { align: 'right', cellClassName: 'tabular-nums' } as const;
/** The money columns, at the width the Revenue page gives its own. */
const money = {
  align: 'right',
  headClassName: 'w-36 min-w-36',
  cellClassName: 'tabular-nums'
} as const;

const detailColumns = (grouping: Grouping) =>
  detailHelper.columns([
    detailHelper.display({
      id: 'name',
      header: USAGE_GROUPINGS.find(g => g.id === grouping)!.label,
      meta: { cellClassName: 'font-medium' },
      cell: ({ row }) =>
        row.original.total ? (
          // The total, to the right of the column it adds up.
          <div className="text-right">{row.original.label}</div>
        ) : (
          row.original.label
        )
    }),
    ...TOKEN_COLUMNS.map(c =>
      detailHelper.display({
        id: c.key,
        header: c.header,
        meta: count,
        cell: ({ row }) => formatNumber(row.original.figures[c.key])
      })
    ),
    detailHelper.display({
      id: 'media',
      header: 'Media',
      meta: { align: 'right' },
      cell: ({ row }) => {
        const f = row.original.figures;
        // The total is one number, as the Media card has it.
        if (row.original.total) {
          return formatNumber(f.images + f.videos + f.audios);
        }
        return mediaText(f) || '—';
      }
    }),
    detailHelper.display({
      id: 'cost',
      header: 'Cost',
      meta: money,
      cell: ({ row }) => (
        <Amount kind="cost" value={row.original.figures.cost} />
      )
    }),
    detailHelper.display({
      id: 'spend',
      header: 'Spend',
      meta: money,
      cell: ({ row }) => formatUsd(row.original.figures.spend)
    })
  ]);

/**
 * Usage over a window, as the Usage page shows everyone's and a user's page
 * shows theirs: the four totals, then each day's usage, then what each
 * model, provider or capability used.
 */
export function UsageReport({
  stats,
  dates,
  hourly = false
}: {
  stats: UsageStats;
  dates: Date[];
  /** Each of `dates` an hour of one day rather than a day. */
  hourly?: boolean;
}) {
  // The chart's grouping, which the table follows.
  const [grouping, setGrouping] = useState<Grouping>('model');
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <UsageTotals stats={stats} />
      </div>
      <DailyUsageChart
        stats={stats}
        dates={dates}
        hourly={hourly}
        grouping={grouping}
        onGroupingChange={setGrouping}
      />
      <UsageDetails stats={stats} grouping={grouping} />
    </>
  );
}

/**
 * Every model, provider or capability over the window, as the chart above
 * groups them, the most spent on first: each kind of token it used, what
 * else it made or heard, and its cost beside its spend — then what they add
 * up to.
 */
function UsageDetails({
  stats,
  grouping
}: {
  stats: UsageStats;
  grouping: Grouping;
}) {
  const columns = useMemo(() => detailColumns(grouping), [grouping]);
  const groups = groupTotals(stats, grouping);
  const rows: DetailRow[] =
    groups.length === 0
      ? []
      : [
          ...groups.map(g => ({
            id: `group:${g.key ?? ''}`,
            label: g.label,
            total: false,
            figures: g.figures
          })),
          { id: 'total', label: 'Total', total: true, figures: totalOf(groups) }
        ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      empty="No usage in this period."
      getRowId={r => r.id}
    />
  );
}

/** The report while its figures are on their way: the cards and the chart,
 *  then the table. */
export function UsageReportSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="py-0">
            <CardContent className="space-y-2 p-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-3 w-28" />
            </CardContent>
          </Card>
        ))}
      </div>
      <ChartSkeleton grouped />
      <Skeleton className="h-48 w-full rounded-md" />
    </div>
  );
}
