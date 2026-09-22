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
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import {
  DailyStackedChart,
  UsageModule,
  UsageModuleSkeleton
} from '@/components/usage-module';
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

export default function UsagePage() {
  const queryClient = useQueryClient();
  const [days, setDays] = useSearchFilter('days', 7);
  const [refreshing, setRefreshing] = useState(false);
  const from = useMemo(() => reportWindowStart(days), [days]);
  const { data, isLoading } = useQuery(usageQueries.adminList({ from }));

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: usageQueries.all() });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium">Stats</h2>
          <div className="flex items-center gap-2">
            <Select
              value={String(days)}
              onValueChange={v => setDays(Number(v))}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Today</SelectItem>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="Refresh"
            >
              <RefreshCw
                className={`size-4 ${refreshing ? 'animate-spin' : ''}`}
              />
            </Button>
          </div>
        </div>

        {isLoading ? (
          <UsageModuleSkeleton isAdmin />
        ) : (
          data && (
            <>
              <UsageModule
                kpi={data.kpi}
                rows={data.rows}
                days={days}
                chartTitle="Daily model cost"
              />
              <DailyStackedChart
                rows={data.rows}
                groupBy="provider"
                days={days}
                title="Daily provider cost"
              />
              <DailyStackedChart
                rows={data.rows}
                groupBy="capability"
                days={days}
                title="Daily capability cost"
              />
            </>
          )
        )}

        <UsageLog days={days} />
      </section>
    </div>
  );
}

function UsageLog({ days }: { days: number }) {
  const [userQuery, setUserQuery] = useSearchFilter('user', '');
  const [modelId, setModelId] = useSearchFilter('model', '');
  const [capability, setCapability] = useSearchFilter('capability', '');
  const [page, setPage] = useSearchFilter('page', 1);

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

  return (
    <Card className="py-0">
      <CardContent className="p-4">
        <div className="mb-3 text-base font-medium">Logs</div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search user (name or email)..."
            value={userQuery}
            onChange={e => setUserQuery(e.target.value)}
            className="w-64"
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
        </div>

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
      </CardContent>
    </Card>
  );
}
