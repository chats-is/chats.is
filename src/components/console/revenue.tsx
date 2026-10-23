import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { RefreshCw } from 'lucide-react';

import { billingIntervalOf } from '@/types/payment';
import { formatPrice } from '@/lib/format-amount';
import { cn, formatNumber, formatUsd } from '@/lib/utils';
import { useSearchFilter } from '@/hooks/use-search-filter';
import {
  revenueQueries,
  type adminRevenue,
  type adminRevenueLossUsers
} from '@/server/functions/revenue';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Amount } from '@/components/console/amount';
import { DailyLineChart } from '@/components/console/daily-line-chart';
import {
  createAppColumnHelper,
  DataTable
} from '@/components/console/data-table';
import { RevenueCostChart } from '@/components/console/revenue-cost-chart';
import { ChartSkeleton } from '@/components/console/skeletons';
import { StatCard } from '@/components/console/stat-card';
import { ConsoleFilters, ConsoleToolbar } from '@/components/console/toolbar';
import { UserCell } from '@/components/console/user-cell';
import {
  DateRangeFilter,
  useReportWindow
} from '@/components/date-range-filter';

type RevenueReport = Awaited<ReturnType<typeof adminRevenue>>;
type RevenuePlanRow = RevenueReport['byPlan'][number];
type LossUsers = Awaited<ReturnType<typeof adminRevenueLossUsers>>;
type RevenueLossUser = LossUsers['rows'][number];

/** Subscriptions gained and lost, each in a colour of its own. */
const COLOR = {
  new: { bar: '#10b981', text: 'text-emerald-600 dark:text-emerald-400' },
  churned: { bar: '#ef4444', text: 'text-destructive' }
} as const;

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
      id: 'cost',
      header: 'Cost',
      meta: money,
      cell: ({ row }) => <Amount kind="cost" value={row.original.cost} />
    }),
    planHelper.display({
      id: 'profit',
      header: 'Profit',
      meta: money,
      cell: ({ row }) => <Amount kind="profit" value={row.original.profit} />
    }),
    planHelper.display({
      id: 'spend',
      header: 'Spend',
      meta: money,
      cell: ({ row }) => formatUsd(row.original.spend)
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
      id: 'cost',
      header: 'Cost',
      meta: money,
      cell: ({ row }) => <Amount kind="cost" value={row.original.cost} />
    }),
    userHelper.display({
      id: 'profit',
      header: 'Profit',
      meta: money,
      cell: ({ row }) => <Amount kind="profit" value={row.original.profit} />
    }),
    userHelper.display({
      id: 'spend',
      header: 'Spend',
      meta: money,
      cell: ({ row }) => formatUsd(row.original.spend)
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
  const { window, value, until, hourly, setWindow } = useReportWindow();
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useSearchFilter('page', 1);

  const report = useQuery(
    revenueQueries.report({ from: window.start, to: until, hourly })
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
      <ConsoleToolbar>
        <ConsoleFilters>
          <DateRangeFilter
            value={value}
            start={window.start}
            last={window.last}
            onChange={setWindow}
          />
        </ConsoleFilters>
        <Button
          variant="outline"
          size="icon"
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh"
        >
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </ConsoleToolbar>
      {report.data ? (
        <div
          className={cn(
            'space-y-4 transition-opacity',
            report.isPlaceholderData && 'pointer-events-none opacity-60'
          )}
        >
          <RevenueFigures
            report={report.data}
            hourly={hourly}
            lossUsers={lossUsers.isLoading ? undefined : lossUsers.data}
            lossUsersPending={lossUsers.isPlaceholderData}
            onPageChange={setPage}
          />
        </div>
      ) : (
        <FiguresSkeleton />
      )}
    </div>
  );
}

function RevenueFigures({
  report,
  hourly,
  lossUsers,
  lossUsersPending,
  onPageChange
}: {
  report: RevenueReport;
  /** Each of the report's days an hour of one day. */
  hourly: boolean;
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
      canceled: sum(r => r.canceled),
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
    const subscriptionDays = report.days.map(d => ({
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
          label: hourly ? 'Subscribers at hour end' : 'Subscribers at day end',
          value: formatNumber(d.subscribers)
        }
      ]
    }));
    return {
      f,
      planColumns: planColumns(planLabel),
      userColumns: userColumns(planLabel),
      planRows,
      subscriptionDays
    };
  }, [report, hourly]);
  const { f } = view;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="MRR"
          value={<Amount kind="revenue" value={f.mrr} />}
          sub="Renewing subscriptions, as a month"
        />
        <StatCard
          title="Subscribers"
          value={formatNumber(f.subscribers)}
          sub={`${formatNumber(f.subscribers - f.canceled)} renewing · ${formatNumber(f.canceled)} canceled`}
        />
        <StatCard
          title="New"
          value={
            <span className={COLOR.new.text}>{formatNumber(f.started)}</span>
          }
          sub="Subscriptions begun in this period"
        />
        <StatCard
          title="Churned"
          value={
            <span className={COLOR.churned.text}>
              {formatNumber(f.churned)}
            </span>
          }
          sub="Subscriptions ended in this period"
        />
      </div>

      <DailyLineChart
        title={
          hourly ? 'Hourly subscription changes' : 'Daily subscription changes'
        }
        series={[
          { label: 'New', color: COLOR.new.bar },
          { label: 'Churned', color: COLOR.churned.bar }
        ]}
        rows={view.subscriptionDays}
        formatTick={formatNumber}
        whole
        hourly={hourly}
        empty="No subscriptions begun or ended in this period."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Revenue"
          value={<Amount kind="revenue" value={f.revenue} />}
          sub={`${formatPrice(f.cash)} received in this period`}
        />
        <StatCard
          title="Cost"
          value={<Amount kind="cost" value={f.cost} />}
          sub="Paid to providers for users' calls"
        />
        <StatCard
          title="Profit"
          value={<Amount kind="profit" value={f.profit} />}
          sub={
            f.margin == null
              ? 'No revenue in this period'
              : `${(f.margin * 100).toFixed(1)}% of revenue`
          }
        />
        <StatCard
          title="Spend"
          value={formatUsd(f.spend)}
          sub="Used by users, at their tier's price"
        />
      </div>

      <RevenueCostChart days={report.days} hourly={hourly} />

      <section className="space-y-3">
        <TableTitle>Plan profit and loss</TableTitle>
        <DataTable
          columns={view.planColumns}
          data={view.planRows}
          empty="No plans with activity in this period."
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
    <div className="space-y-4">
      {cards}
      <ChartSkeleton />
      {cards}
      <ChartSkeleton />
      {table}
      {table}
    </div>
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
