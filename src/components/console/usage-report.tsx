import { Fragment, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { USAGE_GROUPINGS } from '@/lib/constant';
import { tokensOf } from '@/lib/usage-breakdown';
import { cn, formatNumber, formatUsd } from '@/lib/utils';
import { type adminUsageStats } from '@/server/functions/usage';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Amount } from '@/components/console/amount';
import {
  DailyUsageChart,
  groupTotals,
  mediaItems,
  searchItems,
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

/** Each kind of token, as the table names it, in this order, with how many
 *  of it a row used: the input and output less the pictures read and drawn,
 *  which are named apart, as the Logs name them. */
const TOKEN_KINDS: Array<{
  key: string;
  label: string;
  of: (f: Figures) => number;
}> = [
  { key: 'input', label: 'Input', of: f => f.inputTokens - f.imageInputTokens },
  {
    key: 'output',
    label: 'Output',
    of: f => f.outputTokens - f.imageOutputTokens
  },
  { key: 'imageInput', label: 'Image input', of: f => f.imageInputTokens },
  { key: 'imageOutput', label: 'Image output', of: f => f.imageOutputTokens },
  { key: 'reasoning', label: 'Reasoning', of: f => f.reasoningTokens },
  { key: 'cacheRead', label: 'Cache read', of: f => f.cacheReadTokens },
  { key: 'cacheWrite', label: 'Cache write', of: f => f.cacheWriteTokens }
];

const detailHelper = createAppColumnHelper<DetailRow>();

/** Every cell at the top of its row, so an open row's first line stays level
 *  with the others'. */
const top = 'align-top';
/** Counts, to the right. */
const counts = {
  align: 'right',
  cellClassName: `${top} tabular-nums`
} as const;
/** The money columns, at the width the Revenue page gives its own. */
const money = {
  align: 'right',
  headClassName: 'w-36 min-w-36',
  cellClassName: `${top} tabular-nums`
} as const;

/** The kinds of token a row used. */
const tokenKinds = (f: Figures) => TOKEN_KINDS.filter(k => k.of(f) > 0);

/** Whether a row holds more than its closed line shows. */
const opens = (f: Figures) =>
  tokenKinds(f).length > 1 ||
  mediaItems(f).length > 1 ||
  searchItems(f).length > 1;

/**
 * A cell as its row stands, closed or open, with the other way kept beside
 * it, unseen and taking no height: a column is as wide as its widest cell,
 * and with only what shows counted, opening a row widened it and moved every
 * column after it.
 */
function Opening({
  open,
  closed,
  full
}: {
  open: boolean;
  closed: React.ReactNode;
  full: React.ReactNode;
}) {
  return (
    <>
      {open ? full : closed}
      <div aria-hidden className="invisible h-0 overflow-hidden">
        {open ? closed : full}
      </div>
    </>
  );
}

/** A cell's counts: the first, and how many more, while its row is closed;
 *  each on a line of its own once it is open. A dash for none. */
function Items({ items, open }: { items: string[]; open: boolean }) {
  if (items.length === 0) return '—';
  return (
    <Opening
      open={open}
      closed={
        <span className="whitespace-nowrap">
          {items[0]}
          {items.length > 1 && (
            <span className="ml-1.5 text-muted-foreground">
              +{items.length - 1}
            </span>
          )}
        </span>
      }
      full={
        <div className="space-y-0.5 whitespace-nowrap">
          {items.map(item => (
            <div key={item}>{item}</div>
          ))}
        </div>
      }
    />
  );
}

const detailColumns = (
  grouping: Grouping,
  openIds: ReadonlySet<string>,
  toggle: (id: string) => void
) =>
  detailHelper.columns([
    detailHelper.display({
      id: 'name',
      header: USAGE_GROUPINGS.find(g => g.id === grouping)!.label,
      // Past the chevron, so the heading sits over the names.
      meta: { headClassName: 'pl-9', cellClassName: `${top} font-medium` },
      cell: ({ row }) => {
        const open = openIds.has(row.original.id);
        return (
          <div className="flex items-center gap-2">
            {opens(row.original.figures) ? (
              <button
                type="button"
                aria-label={open ? 'Collapse' : 'Expand'}
                aria-expanded={open}
                className="flex shrink-0 text-muted-foreground"
                onClick={() => toggle(row.original.id)}
              >
                <ChevronRight
                  className={cn(
                    'size-4 transition-transform',
                    open && 'rotate-90'
                  )}
                />
              </button>
            ) : (
              // Its room kept, so the names line up.
              <span className="size-4 shrink-0" />
            )}
            <div
              className={cn(
                'min-w-0 flex-1',
                // The total, to the right of the column it adds up.
                row.original.total && 'text-right'
              )}
            >
              {row.original.label}
            </div>
          </div>
        );
      }
    }),
    detailHelper.display({
      id: 'tokens',
      header: 'Tokens',
      meta: counts,
      // Closed, how many in all; open, each kind it used, named, its count
      // to the right of the name.
      cell: ({ row }) => {
        const f = row.original.figures;
        const used = tokenKinds(f);
        if (used.length === 0) return '—';
        return (
          <Opening
            open={openIds.has(row.original.id)}
            closed={formatNumber(tokensOf(f))}
            full={
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 whitespace-nowrap">
                {used.map(k => (
                  <Fragment key={k.key}>
                    <span className="text-left text-muted-foreground">
                      {k.label}
                    </span>
                    <span>{formatNumber(k.of(f))}</span>
                  </Fragment>
                ))}
              </div>
            }
          />
        );
      }
    }),
    detailHelper.display({
      id: 'media',
      header: 'Media',
      meta: counts,
      cell: ({ row }) => (
        <Items
          items={mediaItems(row.original.figures)}
          open={openIds.has(row.original.id)}
        />
      )
    }),
    detailHelper.display({
      id: 'search',
      header: 'Search',
      meta: counts,
      cell: ({ row }) => (
        <Items
          items={searchItems(row.original.figures)}
          open={openIds.has(row.original.id)}
        />
      )
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
 * groups them, the most spent on first: the tokens it used, what else it made
 * or heard, and what its searches fetched, and its cost beside its spend —
 * then what they add up to. A row shows a line each, and opens onto each kind
 * of token and every count.
 */
function UsageDetails({
  stats,
  grouping
}: {
  stats: UsageStats;
  grouping: Grouping;
}) {
  // The rows opened to show all they hold, by identity.
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const columns = useMemo(
    () =>
      detailColumns(grouping, openIds, id =>
        setOpenIds(previous => {
          const ids = new Set(previous);
          if (!ids.delete(id)) ids.add(id);
          return ids;
        })
      ),
    [grouping, openIds]
  );
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
