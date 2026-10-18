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

import {
  billingIntervalOf,
  canUpgrade,
  paymentProcessorSchema,
  type BillingInterval,
  type PaymentProcessorId
} from '@/types/payment';
import { BILLING_INTERVALS } from '@/lib/constant';
import { formatPrice } from '@/lib/format-amount';
import { cn } from '@/lib/utils';
import { sessionQueries } from '@/server/functions/auth';
import { quotaQueries } from '@/server/functions/quota';
import { settingsQueries } from '@/server/functions/settings';
import {
  confirmCheckout,
  previewUpgrade,
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LocalTime } from '@/components/local-time';

type PlanForSale = Awaited<ReturnType<typeof listPlansForSale>>[number];
type Mine = NonNullable<Awaited<ReturnType<typeof getMySubscription>>>;

/** What a plan's button does for the reader, from where they stand. */
type PlanAction =
  /** Not signed in: signing in comes first. */
  | 'sign-in'
  /** No subscription: from the free plan to this one, through checkout. */
  | 'subscribe'
  /** Their plan, canceled and still in effect: renewing again. */
  | 'resubscribe'
  /** Their plan. */
  | 'current'
  /** Dearer, at the same interval and processor: changed now. */
  | 'upgrade'
  /** Anything else: a new subscription, once theirs has ended. */
  | 'later';

function actionFor(
  plan: PlanForSale,
  { signedIn, mine }: { signedIn: boolean; mine: Mine | null }
): PlanAction {
  if (!signedIn) return 'sign-in';
  if (!mine) return 'subscribe';
  if (mine.planId === plan.id)
    return mine.canResume ? 'resubscribe' : 'current';
  if (
    mine.canUpgrade &&
    canUpgrade(
      { price: mine.price, interval: mine.interval, processor: mine.processor },
      plan
    )
  ) {
    return 'upgrade';
  }
  return 'later';
}

/**
 * The plans to choose from, over the page rather than instead of it, one
 * interval at a time: where plans are sold at more than one, a choice
 * above them picks which are shown.
 *
 * Everyone starts on the free plan, so a plan is an upgrade from it. Without
 * a subscription, a plan is bought on its payment processor's own checkout
 * page, which sends the user back with `?checkout=` in the address. With
 * one, the only move is up — to a plan that costs more at the same interval
 * — and it starts now. Anything else waits until the current subscription
 * has ended. Someone not signed in sees the same plans, and signs in first.
 */
function PlansDialog({
  open,
  onOpenChange,
  onSignIn,
  returning,
  returned
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How someone not signed in is asked to sign in. */
  onSignIn?: () => void;
  /** Back from paying, and waiting for the subscription to arrive. */
  returning: boolean;
  /** The checkout come back from, to ask its processor about. */
  returned: Returned | null;
}) {
  const queryClient = useQueryClient();
  const { data: user } = useQuery(sessionQueries.me());
  const signedIn = !!user;
  const { data: plans, isLoading } = useQuery({
    ...subscriptionQueries.plans(),
    enabled: open
  });
  const { data: mine } = useQuery({
    ...subscriptionQueries.mine(),
    enabled: open && signedIn,
    // The plan arrives by webhook, so ask until it has.
    refetchInterval: query => (returning && !query.state.data ? 2000 : false)
  });

  // Its webhook may be late, or lost: the processor is asked as well, until
  // the subscription is here.
  useQuery({
    queryKey: [...subscriptionQueries.all(), 'confirm', returned] as const,
    queryFn: async () => {
      await confirmCheckout({ data: returned! });
      await queryClient.invalidateQueries({
        queryKey: subscriptionQueries.key.mine()
      });
      return null;
    },
    enabled: returning && !mine && !!returned,
    refetchInterval: 8000
  });

  // The intervals plans are sold at, and the one shown: as chosen, else the
  // one the user is billed at, else monthly, else the first sold.
  const sold = BILLING_INTERVALS.filter(i =>
    plans?.some(plan => plan.interval === i.value)
  ).map(i => i.value);
  const [chosen, choose] = useState<BillingInterval | null>(null);
  const interval =
    [chosen, mine?.interval, 'month' as const].find(
      (i): i is BillingInterval => !!i && sold.includes(i)
    ) ?? sold[0];
  const shown = (plans ?? []).filter(plan => plan.interval === interval);
  const [upgradeTo, setUpgradeTo] = useState<PlanForSale | null>(null);
  // What the upgrade charges today, asked of the processor for the dialog.
  const preview = useQuery({
    queryKey: [...subscriptionQueries.all(), 'preview', upgradeTo?.id] as const,
    queryFn: () => previewUpgrade({ data: { planId: upgradeTo!.id } }),
    enabled: !!upgradeTo,
    staleTime: 0
  });

  const checkout = useMutation({
    mutationFn: (planId: string) => startCheckout({ data: { planId } }),
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
      // A new plan may bring a new tier, and the models it allows.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: subscriptionQueries.all() }),
        queryClient.invalidateQueries({ queryKey: quotaQueries.all() }),
        queryClient.invalidateQueries({
          queryKey: settingsQueries.key.system()
        })
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

  /** What doing a plan's action sets off. */
  const run = (action: PlanAction, plan: PlanForSale) => {
    if (action === 'sign-in') onSignIn?.();
    else if (action === 'subscribe') checkout.mutate(plan.id);
    else if (action === 'resubscribe') resubscribing.mutate();
    else if (action === 'upgrade') setUpgradeTo(plan);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-4rem)] gap-6 overflow-y-auto pb-10 sm:max-w-6xl">
          <DialogHeader className="items-center text-center sm:text-center">
            <DialogTitle className="text-2xl">Choose your plan</DialogTitle>
            <DialogDescription>
              {mine ? (
                <>
                  You are on {mine.planName ?? 'a plan'}, billed{' '}
                  {billingIntervalOf(mine.interval).adverb}.{' '}
                  {mine.status === 'canceled' ? 'It ends on' : 'It renews on'}{' '}
                  <LocalTime value={mine.periodEnd} precision="day" />.
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

          {sold.length > 1 && (
            <div className="flex justify-center">
              <IntervalSwitch
                options={sold}
                value={interval}
                onChange={choose}
              />
            </div>
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
              {shown.map(plan => {
                const action = actionFor(plan, {
                  signedIn,
                  mine: mine ?? null
                });
                return (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    saving={savingOf(plan, plans ?? [])}
                    current={mine?.planId === plan.id}
                    action={
                      <PlanActionButton
                        action={action}
                        busy={busy}
                        loading={
                          (checkout.isPending &&
                            checkout.variables === plan.id) ||
                          (upgrade.isPending &&
                            upgrade.variables === plan.id) ||
                          (resubscribing.isPending && mine?.planId === plan.id)
                        }
                        onClick={() => run(action, plan)}
                      />
                    }
                  />
                );
              })}
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
              {preview.isLoading
                ? 'It starts now. Working out what you are charged today…'
                : preview.data?.amount != null
                  ? `It starts now. You are charged ${formatPrice(preview.data.amount)} today, the difference for the rest of this period.`
                  : 'It starts now. You are charged the difference for the rest of this period today.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={preview.isLoading}
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
 * How much less a plan costs than the plan of its name sold at the shortest
 * interval, reckoned by the day: a whole percentage rounded down, so it
 * never says more than it saves. Null when the name is sold at no shorter
 * interval, or this saves nothing.
 */
function savingOf(
  plan: PlanForSale,
  plans: PlanForSale[]
): { percent: number; than: BillingInterval } | null {
  const days = (p: PlanForSale) => billingIntervalOf(p.interval).days;
  const base = plans
    .filter(p => p.name === plan.name && days(p) < days(plan))
    .sort((a, b) => days(a) - days(b))[0];
  if (!base || base.price <= 0) return null;
  const percent = Math.floor(
    (1 - plan.price / days(plan) / (base.price / days(base))) * 100
  );
  return percent >= 1 ? { percent, than: base.interval } : null;
}

/** Which interval's plans are shown, where plans are sold at more than
 *  one. */
function IntervalSwitch({
  options,
  value,
  onChange
}: {
  options: BillingInterval[];
  value: BillingInterval;
  onChange: (value: BillingInterval) => void;
}) {
  return (
    <Tabs value={value} onValueChange={v => onChange(v as BillingInterval)}>
      <TabsList className="rounded-full border bg-muted/50 p-0.5 group-data-[orientation=horizontal]/tabs:h-8">
        {options.map(option => (
          <TabsTrigger
            key={option}
            value={option}
            className="rounded-full px-3"
          >
            {billingIntervalOf(option).label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function PlanCard({
  plan,
  saving,
  current = false,
  action
}: {
  plan: PlanForSale;
  /** What it saves over its name at a shorter interval, where it does. */
  saving: { percent: number; than: BillingInterval } | null;
  /** The plan the reader is on. */
  current?: boolean;
  /** What can be done about it, from where the reader stands. */
  action: React.ReactNode;
}) {
  const features = (plan.description ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  return (
    <Card className={cn('w-full py-0 sm:w-80', current && 'border-primary')}>
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <div className="flex h-7 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate font-semibold">{plan.name}</h2>
            {current && <Badge>Current</Badge>}
          </div>
          {saving && (
            <span className="shrink-0 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              Save {saving.percent}% vs {billingIntervalOf(saving.than).adverb}
            </span>
          )}
        </div>

        <div className="text-2xl font-bold">
          {formatPrice(plan.price)}
          <span className="text-sm font-normal text-muted-foreground">
            {' '}
            / {plan.interval}
          </span>
        </div>

        <div>{action}</div>

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

/** A plan's button, as its action reads. */
function PlanActionButton({
  action,
  busy,
  loading,
  onClick
}: {
  action: PlanAction;
  busy: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  const spinner = loading && <Loader2 className="size-4 animate-spin" />;

  switch (action) {
    case 'sign-in':
      return (
        <Button className="w-full" onClick={onClick}>
          Get started
        </Button>
      );
    case 'subscribe':
    case 'upgrade':
      return (
        <Button className="w-full" disabled={busy} onClick={onClick}>
          {spinner}
          Upgrade
        </Button>
      );
    case 'resubscribe':
      return (
        <Button className="w-full" disabled={busy} onClick={onClick}>
          {spinner}
          Resubscribe
        </Button>
      );
    case 'current':
      return (
        <Button variant="outline" className="w-full" disabled>
          <Check className="size-4" />
          Your plan
        </Button>
      );
    case 'later':
      return (
        <Button variant="outline" className="w-full" disabled>
          After your subscription ends
        </Button>
      );
  }
}

/** A checkout come back from: its processor, and what the return carried. */
type Returned = { via: PaymentProcessorId; ref: string | null };

const OpenPlans = createContext<(() => void) | null>(null);

/**
 * Holds the plans dialog, and hands out the way to open it. It also answers
 * the checkout's return: `?checkout=success` opens it on the subscription
 * being set up, and closes it with a word once the plan has arrived;
 * `?checkout=canceled` opens it back on the plans the user left.
 */
export function PlansDialogProvider({
  children,
  onSignIn
}: {
  children: React.ReactNode;
  /** How someone not signed in is asked to sign in, where they can be. */
  onSignIn?: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { checkout, via, ref } = location.search as {
    checkout?: string;
    via?: string;
    ref?: string;
  };
  const [open, setOpen] = useState(false);
  const [returning, setReturning] = useState(false);
  const [returned, setReturned] = useState<Returned | null>(null);
  const openPlans = useCallback(() => setOpen(true), []);

  useEffect(() => {
    if (checkout !== 'success' && checkout !== 'canceled') return;
    setOpen(true);
    setReturning(checkout === 'success');
    const processor = paymentProcessorSchema.safeParse(via);
    setReturned(
      checkout === 'success' && processor.success
        ? { via: processor.data, ref: ref ? String(ref) : null }
        : null
    );
    // Out of the address, so a refresh does not answer the return again.
    const {
      checkout: _,
      via: _via,
      ref: _ref,
      ...rest
    } = location.search as Record<string, unknown>;
    void navigate({ to: location.pathname, search: rest, replace: true });
  }, [checkout, via, ref, location.pathname, location.search, navigate]);

  const { data: mine } = useQuery({
    ...subscriptionQueries.mine(),
    enabled: returning
  });
  useEffect(() => {
    if (!returning || !mine) return;
    setReturning(false);
    setOpen(false);
    void queryClient.invalidateQueries({ queryKey: quotaQueries.all() });
    void queryClient.invalidateQueries({
      queryKey: settingsQueries.key.system()
    });
    toast.success(`You're subscribed to ${mine.planName ?? 'your plan'}.`);
  }, [returning, mine, queryClient]);

  return (
    <OpenPlans.Provider value={openPlans}>
      {children}
      <PlansDialog
        open={open}
        onSignIn={
          onSignIn &&
          (() => {
            setOpen(false);
            onSignIn();
          })
        }
        onOpenChange={next => {
          setOpen(next);
          if (!next) setReturning(false);
        }}
        returning={returning}
        returned={returned}
      />
    </OpenPlans.Provider>
  );
}

/** How a menu opens the plans — or `null` where there is no dialog. */
export function useOpenPlans() {
  return useContext(OpenPlans);
}
