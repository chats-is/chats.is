import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import { usageQueries } from '@/server/functions/usage';
import { Button } from '@/components/ui/button';
import {
  DateRangeFilter,
  useReportWindow
} from '@/components/date-range-filter';
import {
  DailyStackedChart,
  UsageModule,
  UsageModuleSkeleton
} from '@/components/usage-module';

/**
 * What the install spent over a window: the totals, and the day-by-day cost
 * by model, by provider and by capability. The overview's own section — the
 * usage page is the log of the calls behind these figures.
 */
export function UsageStats() {
  const queryClient = useQueryClient();
  const { window, value, until, setWindow } = useReportWindow();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading } = useQuery(
    usageQueries.adminList({
      from: window.start,
      to: until
    })
  );

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
