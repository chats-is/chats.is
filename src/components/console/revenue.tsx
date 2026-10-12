import { useId, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { RefreshCw } from 'lucide-react';

import { billingIntervalOf } from '@/types/payment';
import { formatPrice } from '@/lib/format-amount';
import { formatDate, formatShortDate } from '@/lib/format-date';
import { cn, formatNumber, formatUsd } from '@/lib/utils';
import { useSearchFilter } from '@/hooks/use-search-filter';
import {
  revenueQueries,
  type adminRevenue,
  type adminRevenueLossUsers
} from '@/server/functions/revenue';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger
} from '@/components/ui/hover-card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  createAppColumnHelper,
  DataTable
} from '@/components/console/data-table';
import { UserCell } from '@/components/console/user-cell';
import {
  DateRangeFilter,
  useReportWindow
} from '@/components/date-range-filter';
import { UsageChartSkeleton } from '@/components/usage-module';

type RevenueReport = Awaited<ReturnType<typeof adminRevenue>>;
type RevenuePlanRow = RevenueReport['byPlan'][number];
type LossUsers = Awaited<ReturnType<typeof adminRevenueLossUsers>>;
type RevenueLossUser = LossUsers['rows'][number];

/** The charts' plotting height in pixels: `h-40`. */
const CHART_HEIGHT = 160;

/**
 * Each kind of figure has a colour of its own, the same in the cards, the
 * tables and the charts: money coming in, money going out, what users used,
 * and what is left — green while it is a profit, red once it is a loss.
 * Subscriptions gained and lost are told apart the same way.
 */
const COLOR = {
  revenue: { bar: '#3b82f6', text: 'text-blue-600 dark:text-blue-400' },
  cost: { bar: '#f59e0b', text: 'text-amber-600 dark:text-amber-400' },
  spend: { bar: '#a855f7', text: 'text-purple-600 dark:text-purple-400' },
  profit: 'text-emerald-600 dark:text-emerald-400',
  loss: 'text-destructive',
  new: { bar: '#10b981', text: 'text-emerald-600 dark:text-emerald-400' },
  churned: { bar: '#ef4444', text: 'text-destructive' }
} as const;

type AmountKind = 'revenue' | 'cost' | 'spend' | 'profit';

/**
 * An amount, in the format the project gives its kind: money paid, and
 * what is left of it, to the cent as a price is (`formatPrice`); what calls
 * cost and users used, to every digit as a cost is (`formatUsd`). A profit
 * under a cent is a cost-sized figure, and shows its digits too.
 */
function amountText(kind: AmountKind, v: number) {
  if (kind === 'cost' || kind === 'spend') return formatUsd(v);
  if (kind === 'profit' && v !== 0 && Math.abs(v) < 0.01) {
    // The sign before the dollar, as a price shows it.
    return `${v < 0 ? '-' : ''}${formatUsd(Math.abs(v))}`;
  }
  return formatPrice(v);
}

function amountColor(kind: AmountKind, v: number) {
  if (kind === 'profit') return v < 0 ? COLOR.loss : COLOR.profit;
  return COLOR[kind].text;
}

function Amount({ kind, value }: { kind: AmountKind; value: number }) {
  return (
    <span className={amountColor(kind, value)}>{amountText(kind, value)}</span>
  );
}

function Stat({
  title,
  value,
  sub
}: {
  title: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <Card className="py-0">
      <CardContent className="space-y-1 p-4">
        <div className="text-sm font-medium text-muted-foreground">{title}</div>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

type Series = { label: string; color: string };

type DayPair = {
  key: string;
  date: Date;
  values: [number, number];
  /** The day's figures, as its hover card lists them. */
  items: Array<{ label: string; color?: string; value: React.ReactNode }>;
};

/** A day's figures, laid out as the usage charts' hover cards are. */
function DayTip({ day }: { day: DayPair }) {
  return (
    <>
      <div className="border-b pb-1.5 text-sm font-medium">
        {formatDate(day.date)}
      </div>
      <div className="space-y-1.5 pt-2">
        {day.items.map(item => (
          <div key={item.label} className="flex items-center gap-1.5 text-xs">
            <span
              className="inline-block size-2.5 shrink-0 rounded-sm"
              style={{ background: item.color ?? 'transparent' }}
            />
            <span className="truncate font-medium">{item.label}</span>
            <span className="ml-auto font-mono">{item.value}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/** The line chart's drawing box; the SVG stretches it to the card. */
const LINE_W = 1000;

/**
 * Catmull-Rom to Bezier, as the usage cards' sparklines draw, with the
 * control points kept inside the box so a curve between a peak and a zero
 * never dips below the axis.
 */
function smoothPath(pts: Array<{ x: number; y: number }>) {
  if (pts.length === 0) return '';
  const clamp = (y: number) => Math.min(CHART_HEIGHT, Math.max(0, y));
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = clamp(p1.y + (p2.y - p0.y) / 6);
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = clamp(p2.y - (p3.y - p1.y) / 6);
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

/**
 * Two figures a day as two curves, drawn the way the usage cards'
 * sparklines are: a smooth line over a fading fill, and a dot on each day
 * that opens the day's figures. A day a figure has nothing has no dot.
 */
function DailyLineChart({
  title,
  series,
  rows,
  formatTick,
  empty,
  whole = false
}: {
  title: string;
  series: [Series, Series];
  rows: DayPair[];
  formatTick: (v: number) => string;
  empty: string;
  /** Figures that are counts, so every tick is a whole number. */
  whole?: boolean;
}) {
  // An id an SVG `url(#…)` can name: letters and digits only.
  const id = `line${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const peak = Math.max(0, ...rows.flatMap(r => r.values));
  // A count's axis rises in whole steps, and its top is the fourth.
  const max = whole ? Math.ceil(peak / 4) * 4 : peak;
  const yTicks = [1, 0.75, 0.5, 0.25, 0].map(f => max * f);
  const labelEvery = rows.length > 14 ? Math.ceil(rows.length / 10) : 1;
  // Each day at the middle of its slot, under which its date sits.
  const xAt = (i: number) => ((i + 0.5) / rows.length) * LINE_W;
  const yAt = (v: number) => CHART_HEIGHT - (v / max) * CHART_HEIGHT;
  const lines = series.map((_, s) =>
    rows.map((r, i) => ({ x: xAt(i), y: yAt(r.values[s]) }))
  );

  return (
    <Card className="py-0">
      <CardContent className="p-4">
        <div className="mb-3 text-base font-medium">{title}</div>
        {max === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {empty}
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <div className="flex h-40 flex-col justify-between pr-1 text-right text-[10px] text-muted-foreground">
                {yTicks.map((t, i) => (
                  <span
                    key={i}
                    style={{ height: 1 }}
                    className="-mt-1 whitespace-nowrap"
                  >
                    {formatTick(t)}
                  </span>
                ))}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="relative h-40 border-b border-l">
                  <svg
                    viewBox={`0 0 ${LINE_W} ${CHART_HEIGHT}`}
                    preserveAspectRatio="none"
                    className="absolute inset-0 h-full w-full overflow-visible"
                  >
                    <defs>
                      {series.map((s, i) => (
                        <linearGradient
                          key={i}
                          id={`${id}-${i}`}
                          x1="0"
                          x2="0"
                          y1="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor={s.color}
                            stopOpacity="0.25"
                          />
                          <stop
                            offset="100%"
                            stopColor={s.color}
                            stopOpacity="0"
                          />
                        </linearGradient>
                      ))}
                    </defs>
                    {lines.map((pts, i) => {
                      const path = smoothPath(pts);
                      const area = `${path} L ${pts[pts.length - 1].x} ${CHART_HEIGHT} L ${pts[0].x} ${CHART_HEIGHT} Z`;
                      return (
                        <g key={i}>
                          <path d={area} fill={`url(#${id}-${i})`} />
                          <path
                            d={path}
                            fill="none"
                            stroke={series[i].color}
                            strokeWidth={1.5}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                          />
                        </g>
                      );
                    })}
                  </svg>
                  {rows.flatMap((r, i) =>
                    r.values.map((v, s) =>
                      v === 0 ? null : (
                        <HoverCard
                          key={`${r.key}-${s}`}
                          openDelay={50}
                          closeDelay={50}
                        >
                          <HoverCardTrigger asChild>
                            <div
                              className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer p-1.5"
                              style={{
                                left: `${(xAt(i) / LINE_W) * 100}%`,
                                top: `${(yAt(v) / CHART_HEIGHT) * 100}%`
                              }}
                            >
                              <div
                                className="size-1.5 rounded-full ring-1 ring-background transition-all hover:size-2"
                                style={{ backgroundColor: series[s].color }}
                              />
                            </div>
                          </HoverCardTrigger>
                          <HoverCardContent
                            side="left"
                            align="center"
                            sideOffset={8}
                            className="w-72 p-3"
                          >
                            <DayTip day={r} />
                          </HoverCardContent>
                        </HoverCard>
                      )
                    )
                  )}
                </div>
                <div className="mt-1 flex">
                  {rows.map((r, i) => (
                    <div
                      key={r.key}
                      className={cn(
                        'flex-1 text-center text-[10px] text-muted-foreground',
                        labelEvery > 1 ? 'whitespace-nowrap' : 'truncate'
                      )}
                    >
                      {i % labelEvery === 0 ? formatShortDate(r.date) : ''}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {series.map(s => (
                <span
                  key={s.label}
                  className="inline-flex items-center gap-1.5 rounded border bg-muted/30 px-2 py-0.5"
                >
                  <span
                    className="inline-block size-2.5 rounded-sm"
                    style={{ background: s.color }}
                  />
                  {s.label}
                </span>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const planHelper = createAppColumnHelper<RevenuePlanRow>();
const userHelper = createAppColumnHelper<RevenueLossUser>();

/**
 * The money columns both tables end on, at one width, so the same figure
 * sits in the same place in each and reads down from one to the other.
 */
const money = {
  align: 'right',
  headClassName: 'w-36 min-w-36',
  cellClassName: 'tabular-nums'
} as const;
const count = { align: 'right', cellClassName: 'tabular-nums' } as const;
/** A free user has no subscription to count. */
const countOf = (planId: string | null, n: number) =>
  planId === null ? '—' : formatNumber(n);

const planColumns = (planLabel: (planId: string | null) => string) =>
  planHelper.columns([
    planHelper.display({
      id: 'plan',
      header: 'Plan',
      meta: { cellClassName: 'font-medium' },
      cell: ({ row }) => planLabel(row.original.planId)
    }),
    planHelper.display({
      id: 'subscribers',
      header: 'Subscribers',
      meta: count,
      cell: ({ row }) => countOf(row.original.planId, row.original.subscribers)
    }),
    planHelper.display({
      id: 'new',
      header: 'New',
      meta: count,
      cell: ({ row }) => countOf(row.original.planId, row.original.started)
    }),
    planHelper.display({
      id: 'churned',
      header: 'Churned',
      meta: count,
      cell: ({ row }) => countOf(row.original.planId, row.original.churned)
    }),
    planHelper.display({
      id: 'revenue',
      header: 'Revenue',
      meta: money,
      cell: ({ row }) => <Amount kind="revenue" value={row.original.revenue} />
    }),
    planHelper.display({
      id: 'consumption',
      header: 'Consumption',
      meta: money,
      cell: ({ row }) => <Amount kind="spend" value={row.original.spend} />
    }),
    planHelper.display({
      id: 'cost',
      header: 'Model cost',
      meta: money,
      cell: ({ row }) => <Amount kind="cost" value={row.original.cost} />
    }),
    planHelper.display({
      id: 'profit',
      header: 'Profit',
      meta: money,
      cell: ({ row }) => <Amount kind="profit" value={row.original.profit} />
    })
  ]);

const userColumns = (planLabel: (planId: string | null) => string) =>
  userHelper.columns([
    userHelper.display({
      id: 'user',
      header: 'User',
      meta: { headClassName: 'w-52 min-w-52', cellClassName: 'max-w-0' },
      cell: ({ row }) => <UserCell user={row.original.user} />
    }),
    userHelper.display({
      id: 'plan',
      header: 'Plan',
      meta: { align: 'right', cellClassName: 'font-medium' },
      cell: ({ row }) => planLabel(row.original.user.planId)
    }),
    userHelper.display({
      id: 'revenue',
      header: 'Revenue',
      meta: money,
      cell: ({ row }) => <Amount kind="revenue" value={row.original.revenue} />
    }),
    userHelper.display({
      id: 'consumption',
      header: 'Consumption',
      meta: money,
      cell: ({ row }) => <Amount kind="spend" value={row.original.spend} />
    }),
    userHelper.display({
      id: 'cost',
      header: 'Model cost',
      meta: money,
      cell: ({ row }) => <Amount kind="cost" value={row.original.cost} />
    }),
    userHelper.display({
      id: 'profit',
      header: 'Profit',
      meta: money,
      cell: ({ row }) => <Amount kind="profit" value={row.original.profit} />
    })
  ]);

function TableTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-base font-medium">{children}</div>;
}

/**
 * Whether the business makes money: what its subscriptions bring in,
 * spread over the time they pay for, against what its users' model calls
 * cost — overall, day by day, by plan and by user — and how its
 * subscriptions stand. The figures are reckoned in SQL
 * (`services/revenue.ts`).
 */
export default function RevenuePage() {
  const queryClient = useQueryClient();
  const { window, value, until, setWindow } = useReportWindow();
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useSearchFilter('page', 1);

  const report = useQuery(
    revenueQueries.report({ from: window.start, to: until })
  );
  const lossUsers = useQuery(
    revenueQueries.lossUsers({ from: window.start, to: until, page })
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({
        queryKey: revenueQueries.all()
      });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <DateRangeFilter
          value={value}
          start={window.start}
          last={window.last}
          onChange={setWindow}
        />
        <Button
          variant="outline"
          size="icon"
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh"
        >
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>
      {report.data ? (
        <div
          className={cn(
            'space-y-6 transition-opacity',
            report.isPlaceholderData && 'pointer-events-none opacity-60'
          )}
        >
          <RevenueFigures
            report={report.data}
            lossUsers={lossUsers.isLoading ? undefined : lossUsers.data}
            lossUsersPending={lossUsers.isPlaceholderData}
            onPageChange={setPage}
          />
        </div>
      ) : report.isError ? (
        <div className="flex flex-col items-center gap-3 rounded-md border py-12 text-sm text-muted-foreground">
          The revenue report could not be loaded.
          <Button
            variant="outline"
            size="sm"
            onClick={() => void report.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : (
        <FiguresSkeleton />
      )}
    </div>
  );
}

function RevenueFigures({
  report,
  lossUsers,
  lossUsersPending,
  onPageChange
}: {
  report: RevenueReport;
  lossUsers?: LossUsers;
  lossUsersPending: boolean;
  onPageChange: (page: number) => void;
}) {
  const view = useMemo(() => {
    const sum = (pick: (r: RevenuePlanRow) => number) =>
      report.byPlan.reduce((n, r) => n + pick(r), 0);
    const revenue = sum(r => r.revenue);
    const cost = sum(r => r.cost);
    const f = {
      revenue,
      cash: sum(r => r.cash),
      cost,
      spend: sum(r => r.spend),
      profit: revenue - cost,
      margin: revenue > 0 ? (revenue - cost) / revenue : null,
      subscribers: sum(r => r.subscribers),
      mrr: sum(r => r.mrr),
      started: sum(r => r.started),
      churned: sum(r => r.churned)
    };
    const plans = new Map(report.plans.map(p => [p.id, p]));
    const planLabel = (planId: string | null) => {
      if (planId === null) return 'Free';
      const p = plans.get(planId);
      return p
        ? `${p.name} · ${billingIntervalOf(p.interval).label}`
        : 'Unknown plan';
    };
    const order = new Map(report.plans.map((p, i) => [p.id, i]));
    const planRows = report.byPlan
      .filter(
        r =>
          r.subscribers ||
          r.started ||
          r.churned ||
          r.revenue ||
          r.cost ||
          r.spend
      )
      .sort(
        (a, b) =>
          (a.planId === null ? Infinity : (order.get(a.planId) ?? 0)) -
          (b.planId === null ? Infinity : (order.get(b.planId) ?? 0))
      );
    const moneyDays = report.days.map((d): DayPair => ({
      key: format(d.start, 'yyyy-MM-dd'),
      date: d.start,
      values: [d.revenue, d.cost],
      items: [
        {
          label: 'Revenue',
          color: COLOR.revenue.bar,
          value: <Amount kind="revenue" value={d.revenue} />
        },
        {
          label: 'Model cost',
          color: COLOR.cost.bar,
          value: <Amount kind="cost" value={d.cost} />
        },
        {
          label: 'Profit',
          value: <Amount kind="profit" value={d.revenue - d.cost} />
        }
      ]
    }));
    const subscriptionDays = report.days.map((d): DayPair => ({
      key: format(d.start, 'yyyy-MM-dd'),
      date: d.start,
      values: [d.started, d.churned],
      items: [
        {
          label: 'New',
          color: COLOR.new.bar,
          value: (
            <span className={COLOR.new.text}>{formatNumber(d.started)}</span>
          )
        },
        {
          label: 'Churned',
          color: COLOR.churned.bar,
          value: (
            <span className={COLOR.churned.text}>
              {formatNumber(d.churned)}
            </span>
          )
        },
        {
          label: 'Subscribers at day end',
          value: formatNumber(d.subscribers)
        }
      ]
    }));
    // Dollars of revenue as a price; a chart of cents alone, as a cost.
    const moneyTick =
      Math.max(0, ...moneyDays.flatMap(d => d.values)) >= 1
        ? formatPrice
        : formatUsd;
    return {
      f,
      planColumns: planColumns(planLabel),
      userColumns: userColumns(planLabel),
      planRows,
      moneyDays,
      moneyTick,
      subscriptionDays
    };
  }, [report]);
  const { f } = view;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          title="Subscribers"
          value={formatNumber(f.subscribers)}
          sub="Subscriptions in effect"
        />
        <Stat
          title="MRR"
          value={<Amount kind="revenue" value={f.mrr} />}
          sub="Subscriptions in effect, as a month"
        />
        <Stat
          title="New"
          value={
            <span className={COLOR.new.text}>{formatNumber(f.started)}</span>
          }
          sub="Subscriptions begun in this window"
        />
        <Stat
          title="Churned"
          value={
            <span className={COLOR.churned.text}>
              {formatNumber(f.churned)}
            </span>
          }
          sub="Subscriptions ended in this window"
        />
      </div>

      <DailyLineChart
        title="Daily subscription changes"
        series={[
          { label: 'New', color: COLOR.new.bar },
          { label: 'Churned', color: COLOR.churned.bar }
        ]}
        rows={view.subscriptionDays}
        formatTick={formatNumber}
        whole
        empty="No subscriptions begun or ended in this window."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          title="Revenue"
          value={<Amount kind="revenue" value={f.revenue} />}
          sub={`${formatPrice(f.cash)} received in this window`}
        />
        <Stat
          title="Model cost"
          value={<Amount kind="cost" value={f.cost} />}
          sub="Paid to providers for users' calls"
        />
        <Stat
          title="Profit"
          value={<Amount kind="profit" value={f.profit} />}
          sub={
            f.margin == null
              ? 'No revenue in this window'
              : `${(f.margin * 100).toFixed(1)}% of revenue`
          }
        />
        <Stat
          title="Consumption"
          value={<Amount kind="spend" value={f.spend} />}
          sub="Used by users, at their tier's price"
        />
      </div>

      <DailyLineChart
        title="Daily revenue and cost"
        series={[
          { label: 'Revenue', color: COLOR.revenue.bar },
          { label: 'Model cost', color: COLOR.cost.bar }
        ]}
        rows={view.moneyDays}
        formatTick={view.moneyTick}
        empty="No revenue or cost in this window."
      />

      <section className="space-y-3">
        <TableTitle>Plan profit and loss</TableTitle>
        <DataTable
          columns={view.planColumns}
          data={view.planRows}
          empty="No plans with activity in this window."
          getRowId={r => r.planId ?? 'free'}
        />
      </section>

      <section className="space-y-3">
        <TableTitle>Loss-making users</TableTitle>
        <DataTable
          columns={view.userColumns}
          data={lossUsers?.rows}
          empty="No user cost more than they brought in."
          getRowId={r => r.user.id}
          pending={lossUsersPending}
          pagination={
            lossUsers && {
              page: lossUsers.page,
              pageSize: lossUsers.pageSize,
              total: lossUsers.total,
              onPageChange
            }
          }
        />
      </section>
    </>
  );
}

function FiguresSkeleton() {
  const cards = (
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
  );
  const table = (
    <div className="space-y-3">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-48 w-full rounded-md" />
    </div>
  );
  // Subscriptions, then money, then the two tables: the page's own order.
  return (
    <>
      {cards}
      <UsageChartSkeleton />
      {cards}
      <UsageChartSkeleton />
      {table}
      {table}
    </>
  );
}

/** The Revenue page before it has drawn. */
export function RevenuePending() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="size-9" />
      </div>
      <FiguresSkeleton />
    </div>
  );
}
