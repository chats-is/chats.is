import { useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { RefreshCw } from 'lucide-react';

import { reportWindowStart } from '@/lib/utils';
import { usageQueries } from '@/server/functions/usage';
import { Button } from '@/components/ui/button';
import {
  DateRangeFilter,
  type DateRangeValue
} from '@/components/date-range-filter';
import {
  DailyStackedChart,
  UsageModule,
  UsageModuleSkeleton
} from '@/components/usage-module';

const DEFAULT_DAYS = 7;

/** `'YYYY-MM-DD'` → local midnight of that day. */
const parseDay = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const addDays = (date: Date, n: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);

/**
 * The window the stats cover, from the address: a chosen range of calendar
 * days when both ends are there, else the last N days ending today.
 */
function useStatsWindow() {
  const search: { days?: number; from?: string; to?: string } = useSearch({
    strict: false
  });
  return useMemo(() => {
    if (search.from && search.to) {
      const start = parseDay(search.from);
      const last = parseDay(search.to);
      const days = Math.round((last.getTime() - start.getTime()) / 864e5) + 1;
      return { custom: true, start, last, days };
    }
    const days = search.days ?? DEFAULT_DAYS;
    const start = reportWindowStart(days);
    return { custom: false, start, last: addDays(start, days - 1), days };
  }, [search.days, search.from, search.to]);
}

/**
 * What the install spent over a window: the totals, and the day-by-day cost
 * by model, by provider and by capability. The overview's own section — the
 * usage page is the log of the calls behind these figures.
 */
export function UsageStats() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const window = useStatsWindow();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading } = useQuery(
    usageQueries.adminList({
      from: window.start,
      // A chosen range ends at the close of its last day; a preset runs to now.
      to: window.custom ? addDays(window.last, 1) : undefined
    })
  );

  // One entry per choice, so the back button undoes it. Either kind of
  // window replaces the other, and the default leaves the address clean.
  const setWindow = (next: DateRangeValue) =>
    void navigate({
      to: '.',
      search: (previous: Record<string, unknown>) => {
        const { days: _d, from: _f, to: _t, ...rest } = previous;
        if (!('days' in next)) {
          return {
            ...rest,
            from: format(next.from, 'yyyy-MM-dd'),
            to: format(next.to, 'yyyy-MM-dd')
          };
        }
        return next.days === DEFAULT_DAYS ? rest : { ...rest, days: next.days };
      }
    });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({
        queryKey: usageQueries.key.adminList()
      });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <DateRangeFilter
          value={
            window.custom
              ? { from: window.start, to: window.last }
              : { days: window.days }
          }
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

      {isLoading ? (
        <UsageModuleSkeleton isAdmin />
      ) : (
        data && (
          <>
            <UsageModule
              kpi={data.kpi}
              rows={data.rows}
              days={window.days}
              endDay={window.last}
              chartTitle="Daily model cost"
            />
            <DailyStackedChart
              rows={data.rows}
              groupBy="provider"
              days={window.days}
              endDay={window.last}
              title="Daily provider cost"
            />
            <DailyStackedChart
              rows={data.rows}
              groupBy="capability"
              days={window.days}
              endDay={window.last}
              title="Daily capability cost"
            />
          </>
        )
      )}
    </section>
  );
}
