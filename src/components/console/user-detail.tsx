import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw } from 'lucide-react';

import { CAPABILITIES } from '@/lib/constant';
import { onSelect } from '@/lib/select';
import { formatUsd, reportWindowStart } from '@/lib/utils';
import { quotaQueries } from '@/server/fn/quota';
import { usageQueries } from '@/server/fn/usage';
import { userQueries } from '@/server/fn/user';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  LimitsSkeleton,
  UsageModule,
  UsageModuleSkeleton
} from '@/components/usage-module';
import { UsageQuantity } from '@/components/usage-quantity';
import { UsageUnitPrice } from '@/components/usage-unit-price';

const fmtDate = (d: Date | string | null) =>
  d ? new Date(d).toLocaleString() : '—';

const sourceLabel: Record<string, string> = {
  override: 'User override',
  plan: 'Plan',
  default: 'Default quota',
  none: 'No quota'
};

export default function UserDetail({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState(7);
  const [refreshing, setRefreshing] = useState(false);

  const from = useMemo(() => reportWindowStart(days), [days]);

  const { data: user, isLoading: userLoading } = useQuery(
    userQueries.detail({
      id: userId
    })
  );
  const { data: status, isLoading: statusLoading } = useQuery(
    quotaQueries.byUser({ userId })
  );
  const { data: usage } = useQuery(usageQueries.byUser({ userId, from }));

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: usageQueries.all() }),
        queryClient.invalidateQueries({
          queryKey: quotaQueries.byUser({ userId }).queryKey
        }),
        queryClient.invalidateQueries({
          queryKey: userQueries.detail({ id: userId }).queryKey
        })
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  if (userLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
        <LimitsSkeleton />
        <UsageModuleSkeleton isAdmin />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-4">
        <Link
          to="/console/users"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to users
        </Link>
        <div className="text-sm text-muted-foreground">User not found.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          to="/console/users"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to users
        </Link>
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

      <div className="flex items-center gap-4">
        <div className="size-14 overflow-hidden rounded-full border bg-muted">
          {user.image ? (
            <img
              src={user.image}
              alt={user.name || ''}
              width={56}
              height={56}
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-lg font-medium text-muted-foreground">
              {user.name?.[0]?.toUpperCase() || user.email[0].toUpperCase()}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">
            {user.name || 'No name'}
          </h1>
          <div className="truncate text-sm text-muted-foreground">
            {user.email}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Joined {fmtDate(user.createdAt)}</span>
            <span>·</span>
            <span>Role: {user.role}</span>
            <span>·</span>
            <span>{user.chatCount} chats</span>
            <span>·</span>
            <span>{user.messageCount} messages</span>
          </div>
        </div>
      </div>

      {status && status.source !== 'none' && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span>
            Plan:{' '}
            <span className="font-medium">
              {status.plan?.name ?? 'Free (no plan)'}
            </span>
          </span>
          <span>·</span>
          <span>
            Quota: <span className="font-medium">{status.name ?? '—'}</span>
          </span>
          <span>·</span>
          <span>
            Source:{' '}
            <span className="font-medium">
              {sourceLabel[status.source] ?? status.source}
            </span>
          </span>
          {status.isUnlimited && (
            <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-300">
              Unlimited
            </span>
          )}
        </div>
      )}

      {statusLoading ? (
        <LimitsSkeleton />
      ) : (
        status &&
        (status.fiveHour || status.sevenDay) && (
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Limits</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {status.fiveHour && (
                <QuotaCard label="5-hour limit" stat={status.fiveHour} />
              )}
              {status.sevenDay && (
                <QuotaCard label="Weekly limit" stat={status.sevenDay} />
              )}
            </div>
          </section>
        )
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium">Stats</h2>
          <Select
            value={String(days)}
            onValueChange={onSelect(v => setDays(Number(v)))}
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
        </div>

        {usage ? (
          <UsageModule kpi={usage.kpi} rows={usage.rows} days={days} />
        ) : (
          <UsageModuleSkeleton isAdmin />
        )}

        <UserLogs userId={userId} days={days} />
      </section>
    </div>
  );
}

function UserLogs({ userId, days }: { userId: string; days: number }) {
  const [modelId, setModelId] = useState<string>('');
  const [capability, setCapability] = useState<string>('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    setPage(1);
  }, [days, userId]);

  const from = useMemo(() => reportWindowStart(days), [days]);

  const { data, isLoading } = useQuery(
    usageQueries.log({
      userId,
      from,
      modelId: modelId || undefined,
      capability: capability
        ? (capability as 'chat' | 'image' | 'video' | 'audio')
        : undefined,
      page,
      pageSize
    })
  );

  const { data: userModels } = useQuery(usageQueries.userModels({ userId }));

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / pageSize));
  }, [data]);

  return (
    <Card className="py-0">
      <CardContent className="p-4">
        <div className="mb-3 text-base font-medium">Logs</div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select
            value={modelId || '__all__'}
            onValueChange={onSelect(v => {
              setModelId(v === '__all__' ? '' : v);
              setPage(1);
            })}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="All models" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All models</SelectItem>
              {userModels?.map(m => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={capability || '__all__'}
            onValueChange={onSelect(v => {
              setCapability(v === '__all__' ? '' : v);
              setPage(1);
            })}
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

        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="p-2 text-left font-medium">Time</th>
                <th className="p-2 text-left font-medium">Model</th>
                <th className="p-2 text-left font-medium">Quantity</th>
                <th className="p-2 text-left font-medium">Unit Price</th>
                <th className="p-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="p-6 text-center text-muted-foreground"
                  >
                    Loading...
                  </td>
                </tr>
              ) : data?.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="p-6 text-center text-muted-foreground"
                  >
                    No records.
                  </td>
                </tr>
              ) : (
                data?.rows.map(r => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="p-2 text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="p-2 align-middle">
                      <div className="text-xs text-muted-foreground">
                        {r.capability}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setModelId(r.modelId ?? '');
                          setPage(1);
                        }}
                        className="block font-mono text-xs hover:text-primary"
                      >
                        {r.modelId ?? '—'}
                      </button>
                    </td>
                    <UsageQuantity row={r} />
                    <UsageUnitPrice row={r} />
                    <td className="p-2 text-right font-mono text-sm">
                      {formatUsd(r.cost)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {data && data.total > pageSize && (
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Page {data.page} of {totalPages} · {data.total} records
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={data.page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={data.page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuotaCard({
  label,
  stat
}: {
  label: string;
  stat: { remainingPct: number; resetAt: Date | string | null };
}) {
  const remainingPct = stat.remainingPct;
  const barColor =
    remainingPct <= 10
      ? 'bg-destructive'
      : remainingPct <= 30
        ? 'bg-amber-500'
        : 'bg-green-500';
  return (
    <Card className="py-0">
      <CardContent className="space-y-2 p-4">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold">{remainingPct}%</div>
        <div className="text-xs text-muted-foreground">remaining</div>
        <div className="h-2 w-full rounded-full bg-muted">
          <div
            className={`h-2 rounded-full ${barColor}`}
            style={{ width: `${remainingPct}%` }}
          />
        </div>
        {stat.resetAt && (
          <div className="text-xs text-muted-foreground">
            Resets {fmtResetAt(new Date(stat.resetAt))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const fmtResetAt = (d: Date): string => {
  const diffMs = d.getTime() - Date.now();
  if (diffMs > 0 && diffMs < 24 * 60 * 60 * 1000) {
    return d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    });
  }
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
};
