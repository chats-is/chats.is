import { useState } from 'react';
import { useSystemSettings } from '@/contexts/system-settings-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { formatPrice } from '@/lib/format-amount';
import { openMyInvoice, paymentQueries } from '@/server/functions/payment';
import {
  cancelSubscription,
  openPaymentMethods,
  resubscribe,
  subscriptionQueries
} from '@/server/functions/subscription';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  PaymentStatusBadge,
  SubscriptionNote
} from '@/components/billing-status';
import { CancelSubscriptionDialog } from '@/components/cancel-subscription-dialog';
import { InvoiceLink } from '@/components/invoice-link';
import { LocalTime } from '@/components/local-time';
import { PaymentMethodIcon } from '@/components/payment-method-icon';
import { RefundedAmount } from '@/components/payment-refund';
import { useOpenPlans } from '@/components/plans-dialog';
import { RefundRequestDialog } from '@/components/refund-request-dialog';
import { useCloseSettings } from '@/components/settings-dialog';

/**
 * The user's billing: their subscription and what they can do to it, and
 * every payment with what was refunded of it and its invoice. Managing a
 * subscription works whether or not plans are still sold; upgrading only
 * while they are.
 *
 * - Renewing: upgrade, change how they pay, cancel, request a refund.
 * - A renewal's payment failed: told so; change how they pay.
 * - Canceled: resubscribe, upgrade, change how they pay, request a refund
 *   — unless an admin, a refund or a dispute canceled it, which the user
 *   cannot undo.
 *
 * A refund request is asked for beside Cancel, and once asked, where it
 * stands shows there in its place.
 */
export function SettingsBilling() {
  const queryClient = useQueryClient();
  const { subscriptionsEnabled } = useSystemSettings();
  const { data: sub, isLoading } = useQuery(subscriptionQueries.mine());
  const { data: payments, isLoading: paymentsLoading } = useQuery(
    paymentQueries.mine()
  );
  const { data: refund } = useQuery({
    ...subscriptionQueries.refundRequest(),
    enabled: !!sub
  });
  const { data: method, isLoading: methodLoading } = useQuery({
    ...subscriptionQueries.paymentMethod(),
    enabled: !!sub
  });
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const openPlans = useOpenPlans();
  const closeSettings = useCloseSettings();
  // The plans open in a dialog of their own, not over this one.
  const showPlans = () => {
    closeSettings?.();
    openPlans?.();
  };

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: subscriptionQueries.all() }),
      queryClient.invalidateQueries({ queryKey: paymentQueries.all() })
    ]);
  const action = (fn: () => Promise<unknown>, done: string) => ({
    mutationFn: fn,
    onSuccess: async () => {
      await refresh();
      toast.success(done);
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const cancel = useMutation(
    action(
      () => cancelSubscription(),
      sub?.paymentFailed
        ? 'Ended.'
        : 'Canceled. Your plan stays until the end of what you paid for.'
    )
  );
  const again = useMutation(
    action(() => resubscribe(), 'Resubscribed. Your plan renews again.')
  );
  // The processor's page opens in a new tab. The tab is opened on the click
  // itself, before the address is known, so it is not taken for a pop-up.
  const card = useMutation({
    mutationFn: async (tab: Window | null) => ({
      tab,
      ...(await openPaymentMethods())
    }),
    onSuccess: ({ tab, url }) => {
      if (tab) tab.location.href = url;
      else window.open(url, '_blank', 'noreferrer');
    },
    onError: (e: Error, tab) => {
      tab?.close();
      toast.error(e.message);
    }
  });
  const busy = cancel.isPending || again.isPending || card.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Your subscription, and what you have paid.
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full rounded-lg" />
      ) : sub ? (
        <section className="space-y-4 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{sub.planName}</span>
              <span className="text-sm text-muted-foreground">
                {formatPrice(sub.price)} / {sub.interval}
              </span>
            </div>
            {subscriptionsEnabled && sub.canUpgrade && (
              <Button variant="outline" size="sm" onClick={showPlans}>
                Upgrade plan
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <div className="flex items-center gap-2 text-sm">
              <CalendarClock className="size-4 text-muted-foreground" />
              <span>
                <SubscriptionNote sub={sub} />
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {sub.canResume && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => again.mutate()}
                >
                  {again.isPending && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  Resubscribe
                </Button>
              )}
              {sub.status === 'active' && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmCancel(true)}
                >
                  Cancel
                </Button>
              )}
              {refund?.canRequest ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setRequesting(true)}
                >
                  Refund
                </Button>
              ) : (
                refund?.latest &&
                refund.latest.status !== 'approved' && (
                  // Where the request stands, in the Refund button's place.
                  <Button variant="outline" size="sm" disabled>
                    {refund.latest.status === 'pending_approval'
                      ? 'Refund pending'
                      : 'Refund rejected'}
                  </Button>
                )
              )}
            </div>
          </div>

          {/* A renewal that could not be paid. */}
          {sub.paymentFailed && (
            <p className="text-sm text-destructive">
              Your payment failed. Update your payment method to keep your
              subscription.
            </p>
          )}
        </section>
      ) : (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
          <span className="font-medium">Free</span>
          {subscriptionsEnabled && (
            <Button variant="outline" size="sm" onClick={showPlans}>
              Upgrade plan
            </Button>
          )}
        </section>
      )}

      {sub && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Payment method</h2>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            {methodLoading ? (
              <Skeleton className="h-6 w-40" />
            ) : method ? (
              <div className="flex items-center gap-3 text-sm">
                <PaymentMethodIcon brand={method.brand ?? method.type} />
                <span className="tabular-nums">
                  {method.last4 ? `•••• ${method.last4}` : labelOf(method)}
                </span>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">
                No payment method on file.
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => card.mutate(window.open('', '_blank'))}
            >
              {card.isPending && <Loader2 className="size-4 animate-spin" />}
              Update
            </Button>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Payments</h2>
        {paymentsLoading ? (
          <Skeleton className="h-20 w-full rounded-lg" />
        ) : !payments?.length ? (
          <p className="text-sm text-muted-foreground">No payments yet.</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Date</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Refunded</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="pl-4 text-muted-foreground">
                      {/* One width, so the dates of every table line up. */}
                      <div className="w-40">
                        <LocalTime value={p.billedAt} />
                      </div>
                    </TableCell>
                    <TableCell className="w-full">{p.plan.name}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatPrice(p.amount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <RefundedAmount payment={p} />
                    </TableCell>
                    <TableCell>
                      <PaymentStatusBadge status={p.status} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <InvoiceLink
                        url={p.invoiceUrl}
                        onDemand={p.invoiceOnDemand}
                        open={() => openMyInvoice({ data: { id: p.id } })}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {sub && (
        <CancelSubscriptionDialog
          open={confirmCancel}
          onOpenChange={setConfirmCancel}
          planName={sub.planName}
          periodEnd={sub.periodEnd}
          ends={sub.paymentFailed}
          onConfirm={() => cancel.mutate()}
        />
      )}

      {refund?.canRequest && (
        <RefundRequestDialog
          open={requesting}
          onOpenChange={setRequesting}
          offer={refund}
        />
      )}
    </div>
  );
}

/** A payment method that is not a card, by its kind: "PayPal". */
function labelOf(method: { type: string; brand: string | null }): string {
  const name = method.brand ?? method.type;
  return name === 'paypal'
    ? 'PayPal'
    : name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
