import { useEffect, useState } from 'react';
import { AlertTriangle, Ban } from 'lucide-react';

import { api } from '@/trpc/react';

/**
 * Inline alert shown above a generation input. Warns the user as their usage
 * limit runs low and blocks visually when exhausted. Server-side
 * `preflightGate` is the real enforcement — this is just a UI heads-up.
 *
 * Shows nothing unless enforcement applies AND remaining drops below 20%.
 * No dollar amounts are ever displayed — only a remaining-% gauge and a
 * countdown to reset (server returns just those two values).
 */
export function UsageLimitAlert() {
  const { data, isLoading } = api.quota.me.useQuery();

  if (isLoading || !data) return null;

  // Pick the most-restrictive window (lowest remainingPct) for the banner.
  const candidates = [data.fiveHour, data.sevenDay].filter(
    (w): w is NonNullable<typeof w> => !!w
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.remainingPct - b.remainingPct);
  const worst = candidates[0];
  const remainingPct = worst.remainingPct;
  if (remainingPct >= 20) return null;

  const exhausted = remainingPct <= 0;
  const Icon = exhausted ? Ban : AlertTriangle;

  return (
    <div
      className={
        exhausted
          ? 'mx-auto mb-2 flex w-full max-w-4xl items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive'
          : 'mx-auto mb-2 flex w-full max-w-4xl items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400'
      }
    >
      <Icon className="size-4 shrink-0" />
      <span className="flex-1">
        {exhausted ? (
          <>You&apos;ve reached your usage limit.</>
        ) : (
          <>You&apos;re approaching your usage limit.</>
        )}
        {worst.resetAt && (
          <>
            {' '}
            {exhausted ? 'Try again in ' : 'Resets in '}
            <Countdown target={new Date(worst.resetAt)} />.
          </>
        )}
      </span>
    </div>
  );
}

/**
 * Live HH:MM countdown to a future date. Re-renders every 30s.
 * Shared by UsageLimitAlert and the /settings/usage cards.
 */
export function Countdown({ target }: { target: Date }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const ms = target.getTime() - now;
  if (ms <= 0) return <>any moment</>;
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return <>{`${days}d ${hours}h`}</>;
  if (hours > 0) return <>{`${hours}h ${minutes}m`}</>;
  return <>{`${minutes}m`}</>;
}
