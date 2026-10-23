import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { RefreshCw } from 'lucide-react';

import { cn, formatNumber } from '@/lib/utils';
import {
  overviewQueries,
  type adminOverview
} from '@/server/functions/overview';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Amount } from '@/components/console/amount';
import { DailyLineChart } from '@/components/console/daily-line-chart';
import { DailyUsageChart } from '@/components/console/daily-usage-chart';
import { RevenueCostChart } from '@/components/console/revenue-cost-chart';
import { ChartSkeleton } from '@/components/console/skeletons';
import { StatCard } from '@/components/console/stat-card';
import { ConsoleFilters, ConsoleToolbar } from '@/components/console/toolbar';
import { UsageTotals } from '@/components/console/usage-totals';
import {
  DateRangeFilter,
  useReportWindow
} from '@/components/date-range-filter';

type Overview = Awaited<ReturnType<typeof adminOverview>>;

/** The colours of the users' curves, and of their figures: new users as
 *  the Revenue page colours its new subscriptions, active users its revenue. */
const COLOR = {
  new: { line: '#10b981', text: 'text-emerald-600 dark:text-emerald-400' },
  active: { line: '#3b82f6', text: 'text-blue-600 dark:text-blue-400' }
} as const;

/**
 * The console's home: over one window, the install's users, its money and
 * its usage, each as four figures beside a chart of its days. The figures
 * are summed in SQL by the user, usage and revenue services.
 */
export default function OverviewPage() {
  const queryClient = useQueryClient();
  const { window, value, until, hourly, points, setWindow } = useReportWindow();
  const [refreshing, setRefreshing] = useState(false);

  const report = useQuery(
    overviewQueries.report({ from: window.start, to: until, hourly })
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({
        queryKey: overviewQueries.all()
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
            'space-y-6 transition-opacity',
            report.isPlaceholderData && 'pointer-events-none opacity-60'
          )}
        >
          <OverviewFigures
            report={report.data}
            dates={points}
            hourly={hourly}
          />
        </div>
      ) : (
        <FiguresSkeleton />
      )}
    </div>
  );
}

/** One part of the page: its four figures beside its chart — one above
 *  the other on a narrow screen. */
function Block({
  stats,
  chart
}: {
  stats: React.ReactNode;
  chart: React.ReactNode;
}) {
  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2">
        {stats}
      </div>
      <div className="lg:col-span-3">{chart}</div>
    </section>
  );
}

function OverviewFigures({
  report,
  dates,
  hourly
}: {
  report: Overview;
  /** Each day of the window, as the page's own calendar has it — or each
   *  hour of its one day. */
  dates: Date[];
  hourly: boolean;
}) {
  const { users, active, usage, revenue } = report;
  // The money as the Revenue page totals it: each plan's, added up.
  const sum = (pick: (r: (typeof revenue.byPlan)[number]) => number) =>
    revenue.byPlan.reduce((n, r) => n + pick(r), 0);
  const money = {
    revenue: sum(r => r.revenue),
    cost: sum(r => r.cost),
    profit: sum(r => r.profit),
    mrr: sum(r => r.mrr),
    subscribers: sum(r => r.subscribers)
  };
  // Every day of the window, from the page's own calendar. The services
  // number their days from 1; users come only for the days that had any,
  // and the others are at nothing.
  const joinedOn = new Map(users.days.map(d => [d.day, d.newUsers]));
  const activeOn = new Map(active.days.map(d => [d.day, d.activeUsers]));
  const days = dates.map((start, i) => ({
    start,
    key: format(start, 'yyyy-MM-dd'),
    newUsers: joinedOn.get(i + 1) ?? 0,
    activeUsers: activeOn.get(i + 1) ?? 0,
    revenue: revenue.days[i]?.revenue ?? 0,
    cost: revenue.days[i]?.cost ?? 0
  }));

  return (
    <>
      <Block
        stats={
          <>
            <StatCard
              title="Total users"
              value={formatNumber(users.total.users)}
              sub="Signed up by the last day"
            />
            <StatCard
              title="New users"
              value={
                <span className={COLOR.new.text}>
                  {formatNumber(users.total.newUsers)}
                </span>
              }
              sub="Signed up in this period"
            />
            <StatCard
              title="Active users"
              value={
                <span className={COLOR.active.text}>
                  {formatNumber(active.total)}
                </span>
              }
              sub="Called a model in this period"
            />
            <StatCard
              title="Paid users"
              value={formatNumber(money.subscribers)}
              sub="With a subscription in effect"
            />
          </>
        }
        chart={
          <DailyLineChart
            title={
              hourly
                ? 'Hourly new and active users'
                : 'Daily new and active users'
            }
            series={[
              { label: 'New', color: COLOR.new.line },
              { label: 'Active', color: COLOR.active.line }
            ]}
            rows={days.map(d => ({
              key: d.key,
              date: d.start,
              values: [d.newUsers, d.activeUsers],
              items: [
                {
                  label: 'New',
                  color: COLOR.new.line,
                  value: formatNumber(d.newUsers)
                },
                {
                  label: 'Active',
                  color: COLOR.active.line,
                  value: formatNumber(d.activeUsers)
                }
              ]
            }))}
            formatTick={formatNumber}
            whole
            hourly={hourly}
            empty="No one signed up or called a model in this period."
          />
        }
      />

      <Block
        stats={
          <>
            <StatCard
              title="MRR"
              value={<Amount kind="revenue" value={money.mrr} />}
              sub="Renewing subscriptions, as a month"
            />
            <StatCard
              title="Revenue"
              value={<Amount kind="revenue" value={money.revenue} />}
              sub="Payments, over the time they pay for"
            />
            <StatCard
              title="Cost"
              value={<Amount kind="cost" value={money.cost} />}
              sub="Paid to providers for users' calls"
            />
            <StatCard
              title="Profit"
              value={<Amount kind="profit" value={money.profit} />}
              sub={
                money.revenue > 0
                  ? `${((money.profit / money.revenue) * 100).toFixed(1)}% of revenue`
                  : 'No revenue in this period'
              }
            />
          </>
        }
        chart={<RevenueCostChart days={days} hourly={hourly} />}
      />

      <Block
        stats={<UsageTotals stats={usage} />}
        chart={<DailyUsageChart stats={usage} dates={dates} hourly={hourly} />}
      />
    </>
  );
}

function FiguresSkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 3 }).map((_, b) => (
        <section key={b} className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2">
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
          <div className="lg:col-span-3">
            {/* The third row is usage's, with the grouped chart. */}
            <ChartSkeleton grouped={b === 2} />
          </div>
        </section>
      ))}
    </div>
  );
}

/** The overview before it has drawn. */
export function OverviewPending() {
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
