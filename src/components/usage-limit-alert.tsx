import { useEffect, useState } from 'react';
import { useSystemSettingsIfLoaded } from '@/contexts/system-settings-context';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Ban } from 'lucide-react';

import { canUpgrade } from '@/types/payment';
import { quotaQueries } from '@/server/functions/quota';
import { subscriptionQueries } from '@/server/functions/subscription';
import { Button } from '@/components/ui/button';
import { useOpenPlans } from '@/components/plans-dialog';

/**
 * Inline alert shown above a generation input. Warns the user as their usage
 * limit runs low and blocks visually when exhausted. Server-side
 * `preflightGate` is the real enforcement — this is just a UI heads-up.
 *
 * Shows nothing unless enforcement applies AND remaining drops below 20%.
 * No amounts are ever displayed — only a remaining-% gauge and a
 * countdown to reset (server returns just those two values).
 *
 * Where a bigger plan is to be had, it offers the way to it: a plan to
 * subscribe to, or one to upgrade to from the plan the user is on.
 */
export function UsageLimitAlert() {
  const { data, isLoading } = useQuery(quotaQueries.me());

  // Pick the most-restrictive window (lowest remainingPct) for the banner.
  const candidates = [data?.fiveHour, data?.sevenDay]
    .filter((w): w is NonNullable<typeof w> => !!w)
    .sort((a, b) => a.remainingPct - b.remainingPct);
  const worst = candidates[0];
  const shown = !isLoading && !!worst && worst.remainingPct < 20;

  const upgrade = useUpgradeOffer(shown);

  if (!shown) return null;
  const remainingPct = worst.remainingPct;
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
      {upgrade && (
        <Button
          size="sm"
          variant={exhausted ? 'destructive' : 'outline'}
          className="h-7 shrink-0 px-2.5 text-xs"
          onClick={upgrade}
        >
          Upgrade plan
        </Button>
      )}
    </div>
  );
}

/**
 * How to open the plans, when there is a bigger plan to go to — or null.
 * Asked only once the alert shows, so a user well within their limits
 * costs nothing: without a subscription, any plan for sale will do; with
 * one, a plan that costs more at the same interval, through the same
 * processor — the only change made in place.
 */
function useUpgradeOffer(wanted: boolean): (() => void) | null {
  const settings = useSystemSettingsIfLoaded();
  const openPlans = useOpenPlans();
  const enabled = wanted && !!settings?.subscriptionsEnabled && !!openPlans;
  const { data: plans } = useQuery({
    ...subscriptionQueries.plans(),
    enabled
  });
  const { data: mine, isSuccess } = useQuery({
    ...subscriptionQueries.mine(),
    enabled
  });
  if (!enabled || !plans || !isSuccess) return null;

  const available = mine
    ? plans.some(plan => {
        const price = mine.interval ? plan.prices[mine.interval] : null;
        return (
          price != null &&
          mine.price != null &&
          mine.interval != null &&
          canUpgrade(
            {
              price: mine.price,
              interval: mine.interval,
              processor: mine.processor
            },
            { price, interval: mine.interval, processor: plan.processor }
          )
        );
      })
    : plans.length > 0;
  return available ? openPlans : null;
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
