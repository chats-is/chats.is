import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RefreshCw } from 'lucide-react';

import { DEFAULT_PAGE_SIZE } from '@/types/pagination';
import { CAPABILITIES } from '@/lib/constant';
import { usageBreakdown, usageSummary } from '@/lib/usage-breakdown';
import { cn, formatUsd } from '@/lib/utils';
import { useSearchFilter } from '@/hooks/use-search-filter';
import { modelQueries } from '@/server/functions/model';
import { usageQueries, type adminUsageLog } from '@/server/functions/usage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { TableCell, TableRow } from '@/components/ui/table';
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
import {
  DateRangeFilter,
  useReportWindow
} from '@/components/date-range-filter';

type UsageLogRow = Awaited<ReturnType<typeof adminUsageLog>>['rows'][number];

const helper = createAppColumnHelper<UsageLogRow>();

const logColumns = helper.columns([
  helper.accessor('createdAt', {
    header: 'Time',
    meta: {
      headClassName: 'w-52',
      cellClassName: 'text-xs whitespace-nowrap text-muted-foreground'
    },
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleString()
  }),
  helper.accessor('userName', {
    header: 'User',
    meta: { headClassName: 'w-48', cellClassName: 'max-w-48' },
    // The name alone keeps the row to one line; an account with no name goes
    // by its address.
    cell: ({ row }) => (
      <Link
        to="/console/users/$userId"
        params={{ userId: row.original.userId }}
        title={row.original.userEmail ?? undefined}
        // Only the name and its icon open the user: the rest of the cell
        // belongs to the row, which opens on a click.
        className="group inline-flex max-w-full items-center gap-1 font-medium hover:text-primary"
      >
        <span className="truncate underline-offset-4 group-hover:underline">
          {row.original.userName || row.original.userEmail || 'Unknown'}
        </span>
        <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
      </Link>
    )
  }),
  helper.accessor('modelId', {
    header: 'Model',
    meta: { headClassName: 'w-96' },
    // One line: the model asked for, the id the provider was actually asked
    // for when routed, and what kind of call it was.
    cell: ({ row }) => (
      <div className="flex items-center gap-2 font-mono text-xs whitespace-nowrap">
        <span>{row.original.modelId ?? '—'}</span>
        {row.original.providerModelId &&
          row.original.providerModelId !== row.original.modelId && (
            <span className="text-muted-foreground">
              → {row.original.providerModelId}
            </span>
          )}
        <Badge variant="secondary" className="font-sans">
          {row.original.capability}
        </Badge>
      </div>
    )
  }),
  helper.display({
    id: 'usage',
    header: 'Usage',
    meta: { align: 'right', cellClassName: 'whitespace-nowrap tabular-nums' },
    cell: ({ row }) => usageSummary(row.original)
  }),
  helper.accessor('cost', {
    header: 'Cost',
    meta: {
      align: 'right',
      headClassName: 'w-36',
      cellClassName: 'font-mono whitespace-nowrap'
    },
    cell: ({ row }) => formatUsd(row.original.cost)
  })
]);

/**
 * What a record was billed for, a row per item under the record's own
 * columns: the item and its rate under Model, how much of it under Usage, what
 * it came to under Cost — so the quantities add up to the record's usage and
 * the subtotals to its cost, each right beneath the figure it makes up.
 */
function UsageItems({ row }: { row: UsageLogRow }) {
  const items = usageBreakdown(row);
  const cell = 'px-2 py-1.5 text-xs';
  const provider = (
    <TableCell className={cn(cell, 'text-muted-foreground')}>
      via {row.providerName ?? 'an unknown provider'}
    </TableCell>
  );

  if (items.length === 0) {
    return (
      <TableRow className="border-b hover:bg-muted/30">
        <TableCell className={cell} />
        {provider}
        <TableCell colSpan={3} className={cn(cell, 'text-muted-foreground')}>
          No rate was recorded for this call, so nothing was billed.
        </TableCell>
      </TableRow>
    );
  }

  return items.map((item, index) => (
    <TableRow
      key={item.label}
      className={cn(
        'hover:bg-muted/30',
        index < items.length - 1 && 'border-b-0'
      )}
    >
      <TableCell className={cell} />
      {index === 0 ? provider : <TableCell className={cell} />}
      <TableCell className={cell}>
        <span className="inline-block w-24">{item.label}</span>
        <span className="font-mono text-muted-foreground">{item.rate}</span>
      </TableCell>
      <TableCell className={cn(cell, 'text-right tabular-nums')}>
        {item.quantity}
      </TableCell>
      <TableCell className={cn(cell, 'text-right font-mono')}>
        {formatUsd(item.subtotal)}
      </TableCell>
    </TableRow>
  ));
}

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
  const [page, setPage] = useSearchFilter('page', 1);
  const [refreshing, setRefreshing] = useState(false);

  const { window, value, until, setWindow } = useReportWindow();

  const { data: models } = useQuery(modelQueries.forSelect());

  const { data, isLoading, isPlaceholderData } = useQuery(
    usageQueries.log({
      from: window.start,
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

      <DataTable
        columns={logColumns}
        data={isLoading ? undefined : data?.rows}
        dense
        empty="No records."
        tableClassName="text-sm"
        renderSubRows={row => <UsageItems row={row} />}
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

/** The usage page while its first rows are on their way. */
export function UsagePending() {
  return <ConsoleTableSkeleton columns={logColumns} filters={3} />;
}
