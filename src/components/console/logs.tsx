import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import { CAPABILITIES, DEFAULT_PAGE_SIZE } from '@/lib/constant';
import { useSearchFilter } from '@/hooks/use-search-filter';
import { modelQueries } from '@/server/functions/model';
import { usageQueries } from '@/server/functions/usage';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { DataTable } from '@/components/console/data-table';
import { ModelStatusName } from '@/components/console/model-status-name';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';
import {
  ConsoleFilters,
  ConsoleSearch,
  ConsoleToolbar
} from '@/components/console/toolbar';
import { UsageItems, usageLogColumns } from '@/components/console/usage-log';
import {
  DateRangeFilter,
  useReportWindow
} from '@/components/date-range-filter';

const logColumns = usageLogColumns({ withUser: true });

/**
 * Every call the install made, one row each, filtered by who, which model,
 * what kind and how far back. The figures these add up to are on the
 * Usage page.
 */
export default function LogsPage() {
  const queryClient = useQueryClient();
  const [userQuery, setUserQuery] = useSearchFilter('user', '');
  const [modelId, setModelId] = useSearchFilter('model', '');
  const [capability, setCapability] = useSearchFilter('capability', '');
  const [page, setPage] = useSearchFilter('page', 1);
  const [refreshing, setRefreshing] = useState(false);

  // Every day until a window is chosen: a record looked for may be from any.
  const { window, value, until, setWindow } = useReportWindow({
    optional: true
  });

  const { data: models } = useQuery(modelQueries.forSelect());

  const { data, isLoading, isPlaceholderData } = useQuery(
    usageQueries.log({
      from: window?.start,
      to: until,
      userQuery: userQuery.trim() || undefined,
      modelId: modelId || undefined,
      capability: capability
        ? (capability as 'chat' | 'image' | 'video' | 'audio')
        : undefined,
      page,
      pageSize: DEFAULT_PAGE_SIZE
    })
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({
        queryKey: usageQueries.key.log()
      });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      <ConsoleToolbar>
        <ConsoleFilters>
          <ConsoleSearch
            placeholder="Search user or ID..."
            value={userQuery}
            onChange={setUserQuery}
          />
          <Select
            value={modelId || '__all__'}
            onValueChange={v => setModelId(v === '__all__' ? '' : v)}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All models" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All models</SelectItem>
              {models?.map(m => (
                <SelectItem key={m.id} value={m.modelId}>
                  <ModelStatusName status={m.status}>
                    {m.modelId}
                  </ModelStatusName>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={capability || '__all__'}
            onValueChange={v => setCapability(v === '__all__' ? '' : v)}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All capabilities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All capabilities</SelectItem>
              {CAPABILITIES.map(c => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DateRangeFilter
            optional
            value={value}
            start={window?.start}
            last={window?.last}
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

      <DataTable
        columns={logColumns}
        data={isLoading ? undefined : data?.rows}
        dense
        empty="No records."
        tableClassName="text-sm"
        renderSubRows={row => <UsageItems row={row} withUser />}
        getRowId={row => row.id}
        pending={isPlaceholderData}
        pagination={
          data && {
            page: data.page,
            pageSize: data.pageSize,
            total: data.total,
            onPageChange: setPage
          }
        }
      />
    </div>
  );
}

/** The logs page while its first rows are on their way. */
export function LogsPending() {
  return <ConsoleTableSkeleton columns={logColumns} filters={3} />;
}
