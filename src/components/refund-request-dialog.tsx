import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { formatPrice } from '@/lib/format-amount';
import {
  submitRefundRequest,
  subscriptionQueries,
  type getMyRefundRequest
} from '@/server/functions/subscription';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { paymentKindLabelOf } from '@/components/billing-labels';
import { LocalTime } from '@/components/local-time';

type Offer = NonNullable<Awaited<ReturnType<typeof getMyRefundRequest>>>;

/**
 * The user asks for a refund. They enter no amount — whether money goes
 * back, and how much, an admin decides — but they see first what they are
 * asking under: the rules as the refund settings have them, and an
 * estimate of what those leave of each payment the request covers.
 */
export function RefundRequestDialog({
  open,
  onOpenChange,
  offer
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offer: Offer;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const submit = useMutation({
    mutationFn: () =>
      submitRefundRequest({ data: { reason: reason.trim() || undefined } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: subscriptionQueries.all()
      });
      toast.success('Refund requested. We will review it shortly.');
      setReason('');
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const { rules } = offer;
  const plan = rules.planName ?? 'your plan';
  const fee =
    rules.refundFee == null
      ? 'Any fee the payment processor charged is not refundable and is taken off the refund.'
      : rules.refundFee > 0
        ? `A refund fee of ${rules.refundFee}% of the payment is taken off the refund.`
        : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg [&_[data-slot=button]]:rounded-full">
        <DialogHeader>
          <DialogTitle>Request a refund</DialogTitle>
          <DialogDescription>
            Your request is reviewed by us, and you will see the decision here.
            Until then your subscription stays as it is.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            <li>
              Payments can be refunded within {rules.days} days of being made.
            </li>
            {fee && <li>{fee}</li>}
            <li>
              If the refund is approved, your subscription to {plan} is
              canceled.
            </li>
            {rules.requestsLeft != null && (
              <li>
                {rules.requestsLeft === 1
                  ? 'This is your last refund request for this subscription: if it is rejected, you cannot request again.'
                  : `You can request a refund ${rules.requestsLeft} more times for this subscription.`}
              </li>
            )}
            <li>
              The refund reaches you once the payment processor has processed
              it, which can take a few business days.
            </li>
          </ul>

          <div className="space-y-2">
            <div className="text-sm font-medium">Estimated refund</div>
            <div className="divide-y rounded-md border text-sm">
              {offer.payments.map(p => (
                <div
                  key={p.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 px-3 py-2"
                >
                  <span className="text-muted-foreground">
                    {paymentKindLabelOf(p.kind)} ·{' '}
                    <LocalTime value={p.billedAt} />
                  </span>
                  <span className="tabular-nums">{formatPrice(p.amount)}</span>
                  <span className="text-right font-medium tabular-nums">
                    {formatPrice(p.estimate)}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between px-3 py-2 font-medium">
                <span>Total</span>
                <span className="tabular-nums">
                  {formatPrice(offer.estimate)}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              An estimate only: the amount refunded is confirmed when your
              request is approved.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="refund-reason">Reason (optional)</Label>
            <Textarea
              id="refund-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submit.isPending}
          >
            Cancel
          </Button>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending && <Loader2 className="size-4 animate-spin" />}
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
