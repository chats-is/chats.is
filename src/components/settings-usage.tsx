import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import { quotaQueries } from '@/server/functions/quota';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Countdown } from '@/components/usage-limit-alert';
import { LimitsSkeleton } from '@/components/usage-module';

export function SettingsUsage() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const { data: quota, isLoading: quotaLoading } = useQuery(quotaQueries.me());

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: quotaQueries.key.me() });
    } finally {
      setRefreshing(false);
    }
  };

  const hasLimits = !!(quota?.fiveHour || quota?.sevenDay);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Usage</h1>
          <p className="text-sm text-muted-foreground">
            Your remaining limits.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh"
        >
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* The limits as they stand now: the 5-hour and the weekly window, one
          under the other. */}
      {quotaLoading ? (
        <LimitsSkeleton />
      ) : (
        hasLimits && (
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Limits</h2>
            <div className="space-y-5">
              {quota.fiveHour && (
                <QuotaWindowRow label="5-hour" window={quota.fiveHour} />
              )}
              {quota.sevenDay && (
                <QuotaWindowRow label="Weekly" window={quota.sevenDay} />
              )}
            </div>
          </section>
        )
      )}
    </div>
  );
}

/**
 * One window of the user's quota, as a row: what it is and when it resets
 * above, how much of it is left below. Shows ONLY the share remaining and
 * the reset time — never the dollar limit or the amount used behind them.
 */
function QuotaWindowRow({
  label,
  window
}: {
  label: string;
  window: { remainingPct: number; resetAt: Date | string | null };
}) {
  const pct = window.remainingPct;
  // Three bands, read at a glance: plenty, running down, nearly out. The
  // track is the same colour, faint, so the empty part reads as the same bar;
  // the component's own colours are the first band.
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
