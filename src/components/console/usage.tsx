import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays } from 'date-fns';
import { RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import { usageQueries } from '@/server/functions/usage';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConsoleFilters, ConsoleToolbar } from '@/components/console/toolbar';
import {
  UsageReport,
  UsageReportSkeleton
} from '@/components/console/usage-report';
import {
  DateRangeFilter,
  useReportWindow
} from '@/components/date-range-filter';

/**
 * What everyone used over a window, and what it cost: the totals and each
 * day's usage, then each model's, provider's or capability's figures in a
 * table. The figures are summed in SQL (`services/usage.ts`); each call is
 * in the Logs.
 */
export default function UsagePage() {
  const queryClient = useQueryClient();
  const { window, value, until, setWindow } = useReportWindow();
  const [refreshing, setRefreshing] = useState(false);

  const stats = useQuery(usageQueries.stats({ from: window.start, to: until }));

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({
        queryKey: usageQueries.key.stats()
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
      {stats.data ? (
        <div
          className={cn(
            'space-y-4 transition-opacity',
            stats.isPlaceholderData && 'pointer-events-none opacity-60'
          )}
        >
          <UsageReport
            stats={stats.data}
            dates={Array.from({ length: window.days }, (_, i) =>
              addDays(window.start, i)
            )}
          />
        </div>
      ) : (
        <UsageReportSkeleton />
      )}
    </div>
  );
}

/** The Usage page before it has drawn. */
export function UsagePending() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="size-9" />
      </div>
      <UsageReportSkeleton />
    </div>
  );
}
