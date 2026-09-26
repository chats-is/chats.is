import { useMemo, useState } from 'react';
import { Link, useCanGoBack, useRouter } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { type UserTier } from '@/types';
import { DEFAULT_PAGE_SIZE } from '@/types/pagination';
import { describeMultiplier } from '@/lib/billing';
import { CAPABILITIES } from '@/lib/constant';
import { mutating } from '@/lib/mutation';
import { cn } from '@/lib/utils';
import { useSearchFilter } from '@/hooks/use-search-filter';
import { quotaQueries } from '@/server/functions/quota';
import { setUserTier, tierQueries } from '@/server/functions/tier';
import { usageQueries } from '@/server/functions/usage';
import { userQueries } from '@/server/functions/user';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/console/data-table';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';
import { ConsoleFilters, ConsoleToolbar } from '@/components/console/toolbar';
import { UsageItems, usageLogColumns } from '@/components/console/usage-log';
import {
  DateRangeFilter,
  useReportWindow
} from '@/components/date-range-filter';
import { Countdown } from '@/components/usage-limit-alert';
import { UsageModule, UsageModuleSkeleton } from '@/components/usage-module';

const sourceLabel: Record<string, string> = {
  override: 'set on the user',
  plan: 'from the plan',
  default: 'the default'
};

/**
 * One user, as the console sees them: who they are and how much of their
 * limits is left, side by side at the top; then one date range that governs
 * both what follows — their figures, and the log of the calls behind them.
 */
export default function UserDetail({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const { window, value, until, setWindow } = useReportWindow();
  const [refreshing, setRefreshing] = useState(false);

  const { data: user, isLoading: userLoading } = useQuery(
    userQueries.detail({ id: userId })
  );
  const { data: status, isLoading: statusLoading } = useQuery(
    quotaQueries.byUser({ userId })
  );
  const { data: usage } = useQuery(
    usageQueries.byUser({ userId, from: window.start, to: until })
  );

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

  // Back to wherever the user was opened from — the users list or the usage
  // log both lead here. A page opened on its own has nowhere to go back to,
  // and goes to the list.
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const backClass =
    'inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground';
  const back = canGoBack ? (
    <button
      type="button"
      onClick={() => router.history.back()}
      className={backClass}
    >
      <ArrowLeft className="size-4" />
      Back
    </button>
  ) : (
    <Link to="/console/users" className={backClass}>
      <ArrowLeft className="size-4" />
      Back to users
    </Link>
  );

  if (userLoading) return <UserDetailSkeleton />;

  if (!user) {
    return (
      <div className="space-y-4">
        {back}
        <div className="text-sm text-muted-foreground">User not found.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        {back}
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

      <Card className="py-0">
        <CardContent className="grid gap-6 p-5 md:grid-cols-2">
          <div className="flex min-w-0 items-center gap-4">
            <div className="size-14 shrink-0 overflow-hidden rounded-full border bg-muted">
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
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-xl font-semibold">
                  {user.name || 'No name'}
                </h1>
                <Badge variant="secondary">{user.role}</Badge>
              </div>
              <div className="truncate text-sm text-muted-foreground">
                {user.email}
              </div>
              <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                {status && (
                  <>
                    <span>{status.plan?.name ?? 'No plan'}</span>
                    <span>·</span>
                    <span>
                      {status.source === 'none'
                        ? 'No quota'
                        : `Quota ${status.name ?? '—'}, ${sourceLabel[status.source] ?? status.source}`}
                    </span>
                    <span>·</span>
                  </>
                )}
                <span>
                  {user.effectiveTier.tier
                    ? `${user.effectiveTier.tier.name} (${describeMultiplier(user.effectiveTier.priceMultiplier)}), ${sourceLabel[user.effectiveTier.source] ?? user.effectiveTier.source}`
                    : 'No tier'}
                </span>
                <span>·</span>
                <span>{user.chatCount} chats</span>
                <span>·</span>
                <span>{user.messageCount} messages</span>
                <span>·</span>
                <span>
                  Joined {new Date(user.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-center gap-4 md:border-l md:pl-6">
            {statusLoading || !status ? (
              <>
                <LimitRowSkeleton />
                <LimitRowSkeleton />
              </>
            ) : status.source === 'none' ? (
              <p className="text-sm text-muted-foreground">
                No quota applies to this user, so their requests are refused.
              </p>
            ) : status.isUnlimited ? (
              <p className="text-sm text-muted-foreground">
                Unlimited — no spending limits apply.
              </p>
            ) : status.fiveHour || status.sevenDay ? (
              <>
                {status.fiveHour && (
                  <LimitRow label="5-hour" window={status.fiveHour} />
                )}
                {status.sevenDay && (
                  <LimitRow label="Weekly" window={status.sevenDay} />
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Their quota sets no limits.
              </p>
            )}
            <TierOverride
              userId={userId}
              own={user.tierId}
              inForce={user.effectiveTier}
            />
          </div>
        </CardContent>
      </Card>

      <div>
        <DateRangeFilter
          value={value}
          start={window.start}
          last={window.last}
          onChange={setWindow}
        />
      </div>

      {usage ? (
        <UsageModule
          kpi={usage.kpi}
          rows={usage.rows}
          days={window.days}
          endDay={window.last}
        />
      ) : (
        <UsageModuleSkeleton isAdmin />
      )}

      <UserLogs userId={userId} from={window.start} to={until} />
    </div>
  );
}

/**
 * The user's own tier, over the plan's and the default's. "Follow the plan"
 * is the choice of none, and says what then applies.
 */
function TierOverride({
  userId,
  own,
  inForce
}: {
  userId: string;
  own: string | null;
  inForce: UserTier;
}) {
  const queryClient = useQueryClient();
  const { data: tierOptions } = useQuery(tierQueries.listForSelect());

  const save = useMutation({
    mutationFn: mutating(setUserTier),
    onSuccess: () => {
      toast.success('Tier saved');
      return queryClient.invalidateQueries({
        queryKey: userQueries.detail({ id: userId }).queryKey
      });
    },
    onError: e => toast.error(e.message)
  });

  // What applies with none of their own — the plan's or the default — so the
  // choice of none is not a blank.
  const followed =
    inForce.source === 'override' || inForce.source === 'none'
      ? 'No tier'
      : `${inForce.tier?.name} (${describeMultiplier(inForce.priceMultiplier)}), ${sourceLabel[inForce.source]}`;

  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="font-medium">Tier</span>
        <span className="text-xs text-muted-foreground">
          {own ? 'set on the user' : followed}
        </span>
      </div>
      <Select
        value={own ?? NO_TIER}
        disabled={save.isPending || !tierOptions}
        onValueChange={value =>
          save.mutate({ id: userId, tierId: value === NO_TIER ? null : value })
        }
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_TIER}>
            {inForce.source === 'override' || inForce.source === 'none'
              ? 'Follow the plan'
              : `Follow the plan — ${followed}`}
          </SelectItem>
          {tierOptions?.map(tier => (
            <SelectItem key={tier.id} value={tier.id}>
              {tier.name} — {describeMultiplier(tier.priceMultiplier)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The select's value for a user on no tier of their own. */
const NO_TIER = '__none__';

/**
 * One window of the user's limits: its name and when it resets, over a bar of
 * what is left. The bands read at a glance — plenty, running down, nearly
 * out — and are the ones the user sees on their own usage page.
 */
function LimitRow({
  label,
  window
}: {
  label: string;
  window: { remainingPct: number; resetAt: Date | string | null };
}) {
  const pct = window.remainingPct;
  const band =
    pct <= 20
      ? 'bg-destructive/15 [&_[data-slot=progress-indicator]]:bg-destructive'
      : pct <= 50
        ? 'bg-amber-500/15 [&_[data-slot=progress-indicator]]:bg-amber-500'
        : 'bg-primary/15';

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="font-medium">{label}</span>
        {window.resetAt && (
          <span className="text-xs text-muted-foreground">
            Resets in <Countdown target={new Date(window.resetAt)} />
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Progress value={pct} className={cn('h-1.5 flex-1', band)} />
        <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          {pct}% left
        </span>
      </div>
    </div>
  );
}

function LimitRowSkeleton() {
  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-1.5 w-full" />
    </div>
  );
}

/** The user's calls over the page's date range, filterable by model and
 *  kind. The model cell doubles as a filter control, so it needs the setter. */
function UserLogs({
  userId,
  from,
  to
}: {
  userId: string;
  from: Date;
  to: Date | undefined;
}) {
  const [modelId, setModelId] = useSearchFilter('model', '');
  const [capability, setCapability] = useSearchFilter('capability', '');
  const [page, setPage] = useSearchFilter('page', 1);

  const { data, isLoading, isPlaceholderData } = useQuery(
    usageQueries.log({
      userId,
      from,
      to,
      modelId: modelId || undefined,
      capability: capability
        ? (capability as 'chat' | 'image' | 'video' | 'audio')
        : undefined,
      page,
      pageSize: DEFAULT_PAGE_SIZE
    })
  );

  const { data: userModels } = useQuery(usageQueries.userModels({ userId }));

  const columns = useMemo(
    () => usageLogColumns({ withUser: false, onModelClick: setModelId }),
    [setModelId]
  );

  return (
    <div className="space-y-4">
      <ConsoleToolbar>
        <ConsoleFilters>
          <Select
            value={modelId || '__all__'}
            onValueChange={v => setModelId(v === '__all__' ? '' : v)}
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
        </ConsoleFilters>
      </ConsoleToolbar>

      <DataTable
        columns={columns}
        data={isLoading ? undefined : data?.rows}
        dense
        empty="No records."
        tableClassName="text-sm"
        renderSubRows={row => <UsageItems row={row} withUser={false} />}
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

/** The page before the user has loaded, in the shape it will take. */
export function UserDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="size-9" />
      </div>
      <Card className="py-0">
        <CardContent className="grid gap-6 p-5 md:grid-cols-2">
          <div className="flex items-center gap-4">
            <Skeleton className="size-14 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-3 w-72" />
            </div>
          </div>
          <div className="flex flex-col justify-center gap-4 md:border-l md:pl-6">
            <LimitRowSkeleton />
            <LimitRowSkeleton />
          </div>
        </CardContent>
      </Card>
      <Skeleton className="h-9 w-36" />
      <UsageModuleSkeleton isAdmin />
      <ConsoleTableSkeleton columns={4} search={false} filters={2} />
    </div>
  );
}
