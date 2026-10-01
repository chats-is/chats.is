import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState
} from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { canUpgrade, type BillingInterval } from '@/types/payment';
import { formatPrice } from '@/lib/format-amount';
import { cn } from '@/lib/utils';
import { quotaQueries } from '@/server/functions/quota';
import {
  resubscribe,
  startCheckout,
  subscriptionQueries,
  upgradePlan,
  type getMySubscription,
  type listPlansForSale
} from '@/server/functions/subscription';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { LocalTime } from '@/components/local-time';

type PlanForSale = Awaited<ReturnType<typeof listPlansForSale>>[number];
type Mine = NonNullable<Awaited<ReturnType<typeof getMySubscription>>>;

const INTERVALS: Array<{ value: BillingInterval; label: string }> = [
  { value: 'month', label: 'Monthly' },
  { value: 'year', label: 'Yearly' }
];

const ADVERB = { month: 'monthly', year: 'yearly' } as const;

/**
 * The plans to subscribe to, over the page rather than instead of it. A
 * plan billed both monthly and yearly has its own Monthly / Yearly choice,
 * which picks the price it shows and the one it is bought at.
 *
 * Without a subscription, a plan is bought at the chosen interval on its
 * payment processor's own checkout page, which sends the user back with
 * `?checkout=` in the address. With one, the only move is up — to a plan
 * that costs more at the same interval — and it starts now. Anything else
 * waits until the current subscription has ended.
 */
function PlansDialog({
  open,
  onOpenChange,
  returning
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Back from paying, and waiting for the subscription to arrive. */
  returning: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: plans, isLoading } = useQuery({
    ...subscriptionQueries.plans(),
    enabled: open
  });
  const { data: mine } = useQuery({
    ...subscriptionQueries.mine(),
    enabled: open,
    // The plan arrives by webhook, so ask until it has.
    refetchInterval: query => (returning && !query.state.data ? 2000 : false)
  });

  const shown = plans ?? [];
  const [upgradeTo, setUpgradeTo] = useState<PlanForSale | null>(null);

  const checkout = useMutation({
    mutationFn: (data: { planId: string; interval: BillingInterval }) =>
      startCheckout({ data }),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    // The server's own words, or — the request never answered — the same
    // plain line it gives for a checkout that could not be opened.
    onError: (e: Error) =>
      toast.error(
        e instanceof TypeError
          ? 'Checkout could not be opened. Please try again.'
          : e.message
      )
  });
  const upgrade = useMutation({
    mutationFn: (planId: string) => upgradePlan({ data: { planId } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: subscriptionQueries.all() }),
        queryClient.invalidateQueries({ queryKey: quotaQueries.all() })
      ]);
      toast.success('Your plan has been upgraded.');
    },
    onError: (e: Error) => toast.error(e.message)
  });
  const resubscribing = useMutation({
    mutationFn: () => resubscribe(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: subscriptionQueries.all()
      });
      toast.success('Resubscribed. Your plan renews again.');
    },
    onError: (e: Error) => toast.error(e.message)
  });
  const busy =
    checkout.isPending || upgrade.isPending || resubscribing.isPending;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-h-[calc(100dvh-4rem)] gap-6 overflow-y-auto pb-10 sm:max-w-6xl"
          // Closed by its X alone: a click beside it or Escape would lose
          // the choice mid-way.
          onInteractOutside={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
        >
          <DialogHeader className="items-center text-center sm:text-center">
            <DialogTitle className="text-2xl">Upgrade your plan</DialogTitle>
            <DialogDescription>
              {mine ? (
                <>
                  You are on {mine.planName ?? 'a plan'}
                  {mine.interval && `, billed ${ADVERB[mine.interval]}`}.{' '}
                  {mine.canceledAt ? 'It will be canceled on' : 'It renews on'}{' '}
                  <LocalTime
                    value={mine.canceledAt ?? mine.expiresAt}
                    precision="day"
                  />
                  .
                </>
              ) : (
                'Choose the plan that suits you.'
              )}
            </DialogDescription>
          </DialogHeader>

          {returning && !mine && (
            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Payment received. Your plan is being set up.
            </p>
          )}

          {isLoading ? (
            <div className="flex flex-wrap justify-center gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-64 w-full rounded-xl sm:w-80" />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">
              No plans are available yet.
            </p>
          ) : (
            // Centred rows of one width, so two plans sit in the middle
            // rather than leaving a third of the dialog empty.
            <div className="flex flex-wrap justify-center gap-4">
              {shown.map(plan => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  mine={mine ?? null}
                  busy={busy}
                  loading={
                    (checkout.isPending &&
                      checkout.variables?.planId === plan.id) ||
                    (upgrade.isPending && upgrade.variables === plan.id) ||
                    (resubscribing.isPending && mine?.planId === plan.id)
                  }
                  onSubscribe={interval =>
                    checkout.mutate({ planId: plan.id, interval })
                  }
                  onUpgrade={() => setUpgradeTo(plan)}
                  onResubscribe={() => resubscribing.mutate()}
                />
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!upgradeTo}
        onOpenChange={open => !open && setUpgradeTo(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Upgrade to {upgradeTo?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It starts now. You are charged the difference for the rest of this
              period today.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => upgradeTo && upgrade.mutate(upgradeTo.id)}
            >
              Upgrade
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * How much less a year costs paid yearly than paid monthly, as a whole
 * percentage rounded down so it never says more than it saves. Null when
 * the plan is not sold at both, or yearly saves nothing.
 */
function yearlySaving(plan: PlanForSale): number | null {
  const { month, year } = plan.prices;
  if (month == null || year == null || month <= 0) return null;
  const saving = Math.floor((1 - year / (month * 12)) * 100);
  return saving >= 1 ? saving : null;
}

/** The intervals a plan is sold at, in the order they are offered. */
const intervalsOf = (plan: PlanForSale) =>
  INTERVALS.filter(i => plan.prices[i.value] != null);

/**
 * A plan's own Monthly / Yearly choice, for a plan sold at both: beside its
 * name, and only for its own price.
 */
function IntervalSwitch({
  value,
  onChange,
  saving
}: {
  value: BillingInterval;
  onChange: (value: BillingInterval) => void;
  /** Yearly's saving over monthly, in percent, where there is one. */
  saving: number | null;
}) {
  return (
    <div className="inline-flex h-7 shrink-0 items-center rounded-full border bg-muted/50 p-0.5">
      {INTERVALS.map(option => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            'inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap transition-colors',
            value === option.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {option.label}
          {option.value === 'year' && saving != null && (
            <span className="ml-1 font-semibold text-emerald-600 dark:text-emerald-400">
              Save {saving}%
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function PlanCard({
  plan,
  mine,
  busy,
  loading,
  onSubscribe,
  onUpgrade,
  onResubscribe
}: {
  plan: PlanForSale;
  mine: Mine | null;
  busy: boolean;
  loading: boolean;
  onSubscribe: (interval: BillingInterval) => void;
  onUpgrade: () => void;
  onResubscribe: () => void;
}) {
  const sold = intervalsOf(plan);
  // The interval the user is billed at where the plan has it — the one
  // their plan and any upgrade go by — else the first it is sold at.
  const [interval, chooseInterval] = useState<BillingInterval>(
    mine?.interval && plan.prices[mine.interval] != null
      ? mine.interval
      : (sold[0]?.value ?? 'month')
  );
  const price = plan.prices[interval]!;
  const isCurrentPlan = mine?.planId === plan.id;
  const isCurrent = isCurrentPlan && mine?.interval === interval;
  const features = (plan.description ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const spinner = loading && <Loader2 className="size-4 animate-spin" />;

  let button: React.ReactNode;
  if (!mine) {
    button = (
      <Button
        className="w-full"
        disabled={busy}
        onClick={() => onSubscribe(interval)}
      >
        {spinner}
        Subscribe
      </Button>
    );
  } else if (isCurrent && mine.canceledAt) {
    // Canceled, and still in effect: the same plan, renewing again.
    button = (
      <Button className="w-full" disabled={busy} onClick={onResubscribe}>
        {spinner}
        Resubscribe
      </Button>
    );
  } else if (isCurrent) {
    button = (
      <Button variant="outline" className="w-full" disabled>
        <Check className="size-4" />
        Your plan
      </Button>
    );
  } else if (
    mine.price != null &&
    mine.interval &&
    canUpgrade(
      {
        price: mine.price,
        interval: mine.interval,
        processor: mine.processor
      },
      { price, interval, processor: plan.processor }
    )
  ) {
    button = (
      <Button className="w-full" disabled={busy} onClick={onUpgrade}>
        {spinner}
        Upgrade
      </Button>
    );
  } else {
    // Cheaper, another interval, another processor: a new subscription,
    // once the current one is canceled.
    button = (
      <Button variant="outline" className="w-full" disabled>
        After your subscription is canceled
      </Button>
    );
  }

  return (
    <Card className={cn('w-full py-0 sm:w-80', isCurrent && 'border-primary')}>
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <div className="flex h-7 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate font-semibold">{plan.name}</h2>
            {isCurrent && <Badge>Current</Badge>}
          </div>
          {/* Its own choice of interval, where it is sold at both. */}
          {sold.length > 1 && (
            <IntervalSwitch
              value={interval}
              onChange={chooseInterval}
              saving={yearlySaving(plan)}
            />
          )}
        </div>

        <div className="text-2xl font-bold">
          {formatPrice(price)}
          <span className="text-sm font-normal text-muted-foreground">
            {' '}
            / {interval}
          </span>
        </div>

        <div>{button}</div>

        {/* The plan's description, a point to a line, as the admin wrote
            it. */}
        {features.length > 0 && (
          <ul className="space-y-2 text-sm">
            {features.map(feature => (
              <li key={feature} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const OpenPlans = createContext<(() => void) | null>(null);

/**
 * Holds the plans dialog, and hands out the way to open it. It also answers
 * the checkout's return: `?checkout=success` opens it on the subscription
 * being set up, and closes it with a word once the plan has arrived;
 * `?checkout=canceled` opens it back on the plans the user left.
 */
export function PlansDialogProvider({
  children
}: {
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const checkout = (location.search as { checkout?: string }).checkout;
  const [open, setOpen] = useState(false);
  const [returning, setReturning] = useState(false);
  const openPlans = useCallback(() => setOpen(true), []);

  useEffect(() => {
    if (checkout !== 'success' && checkout !== 'canceled') return;
    setOpen(true);
    setReturning(checkout === 'success');
    // Out of the address, so a refresh does not answer the return again.
    const { checkout: _, ...rest } = location.search as Record<string, unknown>;
    void navigate({ to: location.pathname, search: rest, replace: true });
  }, [checkout, location.pathname, location.search, navigate]);

  const { data: mine } = useQuery({
    ...subscriptionQueries.mine(),
    enabled: returning
  });
  useEffect(() => {
    if (!returning || !mine) return;
    setReturning(false);
    setOpen(false);
    void queryClient.invalidateQueries({ queryKey: quotaQueries.all() });
    toast.success(`You're subscribed to ${mine.planName ?? 'your plan'}.`);
  }, [returning, mine, queryClient]);

  return (
    <OpenPlans.Provider value={openPlans}>
      {children}
      <PlansDialog
        open={open}
        onOpenChange={next => {
          setOpen(next);
          if (!next) setReturning(false);
        }}
        returning={returning}
      />
    </OpenPlans.Provider>
  );
}

/** How a menu opens the plans — or `null` where there is no dialog. */
export function useOpenPlans() {
  return useContext(OpenPlans);
}
