import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, TicketCheck } from 'lucide-react';
import { toast } from 'sonner';

import { toAmount, toMinor, type RefundRequestStatus } from '@/types/payment';
import { formatPrice } from '@/lib/format-amount';
import { mutating } from '@/lib/mutation';
import { paymentQueries, refundPayment } from '@/server/functions/payment';
import {
  approveRefundRequest,
  rejectRefundRequest,
  subscriptionQueries
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
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  CancelNowSwitch,
  RefundLineRow,
  type RefundLine
} from '@/components/console/refund-line';
import { RowAction } from '@/components/console/row-action';

/** What the refund dialog is opened on: a payment, or a user's request. */
export type RefundTarget = { payment: string } | { request: string };

/**
 * A request's action, the same wherever it is listed: Review opens the
 * refund dialog while it waits for a decision; once decided, what came of
 * it shows in its row instead.
 */
export function ReviewAction({
  status,
  onClick
}: {
  status: RefundRequestStatus;
  onClick: () => void;
}) {
  return (
    <RowAction
      icon={TicketCheck}
      label="Review"
      disabled={status === 'pending_approval' ? null : 'Already decided'}
      onClick={onClick}
    />
  );
}

/** The one refund, whichever way it is opened. */
interface Refund {
  lines: RefundLine[];
  /** The refund fee percentage the settings have, or null for auto. */
  refundFee: number | null;
  /** Whether its subscription is still running, to be canceled. */
  running: boolean;
  request: {
    id: string;
    reason: string | null;
  } | null;
}

/**
 * An admin refunds: from a payment, that payment; from a user's request,
 * the payments it covers, with the request above and Reject beside Refund.
 * Each payment gives back all that is left of it, as the refund settings
 * reckon it, and the subscription is canceled — at once, or when it
 * expires.
 */
export function RefundDialog({
  target,
  onClose
}: {
  target: RefundTarget | null;
  onClose: () => void;
}) {
  const paymentId = target && 'payment' in target ? target.payment : null;
  const requestId = target && 'request' in target ? target.request : null;
  const payment = useQuery({
    ...paymentQueries.refundDetails(paymentId ?? ''),
    enabled: !!paymentId
  });
  const request = useQuery({
    ...subscriptionQueries.refundRequestDetail(requestId ?? ''),
    enabled: !!requestId
  });

  let refund: Refund | null = null;
  if (paymentId && payment.data) {
    const d = payment.data;
    refund = {
      lines: [d.payment],
      refundFee: d.refundFee,
      running: d.subscription?.status === 'active',
      request: null
    };
  } else if (requestId && request.data) {
    const d = request.data;
    refund = {
      lines: d.payments,
      refundFee: d.refundFee,
      running: d.subscription.status === 'active',
      request: {
        id: d.id,
        reason: d.reason
      }
    };
  }

  return (
    <Dialog open={!!target} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Refund</DialogTitle>
          <DialogDescription className="sr-only">
            Refund a payment.
          </DialogDescription>
        </DialogHeader>
        {refund ? (
          <RefundBody
            key={paymentId ?? requestId}
            refund={refund}
            onClose={onClose}
          />
        ) : (
          <Skeleton className="h-48 w-full" />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RefundBody({
  refund: r,
  onClose
}: {
  refund: Refund;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const request = r.request;
  const [cancelNow, setCancelNow] = useState(true);
  const [rejecting, setRejecting] = useState(false);
  const [rejection, setRejection] = useState('');

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: paymentQueries.all() }),
      queryClient.invalidateQueries({ queryKey: subscriptionQueries.all() })
    ]);
  const total = r.lines.reduce((sum, l) => sum + toMinor(l.left), 0);
  const refund = useMutation({
    mutationFn: () =>
      request
        ? mutating(approveRefundRequest)({
            id: request.id,
            cancelSubscription: cancelNow
          })
        : mutating(refundPayment)({
            paymentId: r.lines[0].id,
            cancelSubscription: cancelNow
          }),
    onSuccess: async () => {
      await refresh();
      toast.success(
        total === 0
          ? 'Approved.'
          : 'Refund sent. The payment shows Refund pending until the payment processor confirms it.'
      );
      onClose();
    },
    onError: async (e: Error) => {
      await refresh();
      toast.error(e.message);
    }
  });
  const reject = useMutation({
    mutationFn: mutating(rejectRefundRequest),
    onSuccess: async () => {
      await refresh();
      toast.success('Rejected.');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message)
  });
  const busy = refund.isPending || reject.isPending;

  return (
    <div className="space-y-5">
      {request?.reason && <p className="text-sm">{request.reason}</p>}

      {r.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {request
            ? 'Its payments have been refunded already. Approving closes the request.'
            : 'Nothing is left to refund.'}
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {r.lines.map(line => (
            <RefundLineRow key={line.id} line={line} refundFee={r.refundFee} />
          ))}
        </div>
      )}

      {r.running && total > 0 && (
        <CancelNowSwitch
          checked={cancelNow}
          onChange={setCancelNow}
          disabled={busy}
        />
      )}

      {request && rejecting && (
        <div className="space-y-2">
          <Label htmlFor="rejection">
            Reason for rejecting (shown to the user)
          </Label>
          <Textarea
            id="rejection"
            rows={3}
            maxLength={500}
            value={rejection}
            onChange={e => setRejection(e.target.value)}
          />
        </div>
      )}

      <DialogFooter>
        {request && rejecting ? (
          <>
            <Button
              variant="outline"
              onClick={() => setRejecting(false)}
              disabled={busy}
            >
              Back
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                reject.mutate({
                  id: request.id,
                  reason: rejection.trim() || undefined
                })
              }
            >
              {reject.isPending && <Loader2 className="size-4 animate-spin" />}
              Reject request
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            {request && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setRejecting(true)}
              >
                Reject
              </Button>
            )}
            <Button
              disabled={busy || (total === 0 && !request)}
              onClick={() => refund.mutate()}
            >
              {refund.isPending && <Loader2 className="size-4 animate-spin" />}
              {total === 0
                ? 'Approve'
                : `Refund ${formatPrice(toAmount(total))}`}
            </Button>
          </>
        )}
      </DialogFooter>
    </div>
  );
}
