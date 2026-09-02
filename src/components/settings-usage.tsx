import { useMemo, useState } from 'react';
import { api } from '@/trpc/react';
import { RefreshCw } from 'lucide-react';

import { reportWindowStart } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Countdown } from '@/components/usage-limit-alert';
import {
  LimitsSkeleton,
  UsageModule,
  UsageModuleSkeleton
} from '@/components/usage-module';

export function SettingsUsage() {
  const utils = api.useUtils();
  const [days, setDays] = useState(7);
  const [refreshing, setRefreshing] = useState(false);
  const from = useMemo(() => reportWindowStart(days), [days]);
  const { data: quota, isLoading: quotaLoading } = api.quota.me.useQuery();
  const { data: usage, isLoading } = api.usage.me.useQuery({ from });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        utils.usage.invalidate(),
        utils.quota.me.invalidate()
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const hasLimits = !!(quota?.fiveHour || quota?.sevenDay);

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Usage</h1>
          <p className="text-sm text-muted-foreground">
            Your remaining limits and usage stats.
          </p>
        </div>
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

      {/* Usage limits — always current (5h / weekly), not affected by the
          report date filter. */}
      {quotaLoading ? (
        <LimitsSkeleton />
      ) : (
        hasLimits && (
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Limits</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {quota.fiveHour && (
                <QuotaSnapshotCard
                  label="5-hour limit"
                  window={quota.fiveHour}
                />
              )}
              {quota.sevenDay && (
                <QuotaSnapshotCard
                  label="Weekly limit"
                  window={quota.sevenDay}
                />
              )}
            </div>
          </section>
        )
      )}

      {/* Usage report — date filter sits directly above it. */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium">Stats</h2>
          <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
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

        {isLoading ? (
          <UsageModuleSkeleton />
        ) : usage ? (
          <UsageModule kpi={usage.kpi} rows={usage.rows} days={days} />
        ) : null}
      </section>
    </div>
  );
}

/**
 * User-facing per-window quota card. Shows ONLY:
 *   - remaining % gauge
 *   - reset time
 * Never displays the underlying dollar limit / used amount.
 */
function QuotaSnapshotCard({
  label,
  window
}: {
  label: string;
  window: { remainingPct: number; resetAt: Date | string | null };
}) {
  const pct = window.remainingPct;
  const barColor =
    pct <= 10 ? 'bg-destructive' : pct <= 30 ? 'bg-amber-500' : 'bg-green-500';

  return (
    <Card className="py-0">
      <CardContent className="space-y-2 p-4">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold">{pct}%</div>
        <div className="text-xs text-muted-foreground">remaining</div>
        <div className="h-2 w-full rounded-full bg-muted">
          <div
            className={`h-2 rounded-full ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {window.resetAt && (
          <div className="text-xs text-muted-foreground">
            Resets in <Countdown target={new Date(window.resetAt)} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
