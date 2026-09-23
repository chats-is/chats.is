import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import { DEFAULT_PAGE_SIZE } from '@/types/pagination';
import { CAPABILITIES } from '@/lib/constant';
import { formatUsd, reportWindowStart } from '@/lib/utils';
import { useSearchFilter } from '@/hooks/use-search-filter';
import { modelQueries } from '@/server/functions/model';
import { usageQueries, type adminUsageLog } from '@/server/functions/usage';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  createAppColumnHelper,
  DataTable
} from '@/components/console/data-table';
import { ModelStatusBadge } from '@/components/console/model-status';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';
import {
  ConsoleFilters,
  ConsoleSearch,
  ConsoleToolbar
} from '@/components/console/toolbar';
import { UsageQuantity } from '@/components/usage-quantity';
import { UsageUnitPrice } from '@/components/usage-unit-price';

type UsageLogRow = Awaited<ReturnType<typeof adminUsageLog>>['rows'][number];

const helper = createAppColumnHelper<UsageLogRow>();

const logColumns = helper.columns([
  helper.accessor('createdAt', {
    header: 'Time',
    meta: { cellClassName: 'text-xs text-muted-foreground' },
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleString()
  }),
  helper.accessor('userName', {
    header: 'User',
    meta: { cellClassName: 'text-sm' },
    cell: ({ row }) => (
      <Link
        to="/console/users/$userId"
        params={{ userId: row.original.userId }}
        className="hover:text-primary"
      >
        <div className="font-medium">{row.original.userName ?? 'Unknown'}</div>
        <div className="text-xs text-muted-foreground">
          {row.original.userEmail}
        </div>
      </Link>
    )
  }),
  helper.accessor('modelId', {
    header: 'Model',
    meta: { cellClassName: 'align-middle' },
    cell: ({ row }) => (
      <>
        <div className="text-xs text-muted-foreground">
          {row.original.capability}
        </div>
        <div className="font-mono text-xs">{row.original.modelId ?? '—'}</div>
        {/* Routed: the id the provider was actually asked for. */}
        {row.original.providerModelId &&
          row.original.providerModelId !== row.original.modelId && (
            <div className="font-mono text-xs text-muted-foreground">
              → {row.original.providerModelId}
            </div>
          )}
      </>
    )
  }),
  helper.display({
    id: 'quantity',
    header: 'Quantity',
    meta: { cellClassName: 'align-middle font-mono text-xs' },
    cell: ({ row }) => <UsageQuantity row={row.original} />
  }),
  helper.display({
    id: 'unitPrice',
    header: 'Unit Price',
    meta: { cellClassName: 'align-middle font-mono text-xs' },
    cell: ({ row }) => <UsageUnitPrice row={row.original} />
  }),
  helper.accessor('cost', {
    header: 'Cost',
    meta: { align: 'right', cellClassName: 'font-mono text-sm' },
    cell: ({ row }) => formatUsd(row.original.cost)
  })
]);

/**
 * Every call the install made, one row each, filtered by who, which model,
 * what kind and how far back. The figures these add up to are on the
 * overview.
 */
export default function UsagePage() {
  const queryClient = useQueryClient();
  const [userQuery, setUserQuery] = useSearchFilter('user', '');
  const [modelId, setModelId] = useSearchFilter('model', '');
  const [capability, setCapability] = useSearchFilter('capability', '');
  const [days, setDays] = useSearchFilter('days', 7);
  const [page, setPage] = useSearchFilter('page', 1);
  const [refreshing, setRefreshing] = useState(false);

  const from = useMemo(() => reportWindowStart(days), [days]);

  const { data: models } = useQuery(modelQueries.forSelect());

  const { data, isLoading, isPlaceholderData } = useQuery(
    usageQueries.log({
      from,
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
            placeholder="Search user..."
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
                  <span className="flex items-center gap-2">
                    {m.modelId}
                    <ModelStatusBadge status={m.status} />
                  </span>
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
          <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Today</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
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

/** The usage page while its first rows are on their way. */
export function UsagePending() {
  return <ConsoleTableSkeleton columns={logColumns} filters={3} />;
}
