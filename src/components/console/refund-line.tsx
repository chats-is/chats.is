import { formatPrice } from '@/lib/format-amount';
import { type getRefundDetails } from '@/server/functions/payment';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { paymentKindLabelOf } from '@/components/billing-labels';
import { PaymentStatusBadge } from '@/components/billing-status';
import { LocalTime } from '@/components/local-time';

/** One payment as a refund shows it, the same wherever it is refunded. */
export type RefundLine = Awaited<
  ReturnType<typeof getRefundDetails>
>['payment'];

/**
 * How the refund of a payment is reckoned, spelled out with its numbers,
 * as `refundShareMinor` reckons it: with a refund fee, that share of what
 * was paid; on auto, what was paid less the processor's fee — and where
 * the processor holds the tax too, in proportion to what was paid before
 * tax.
 */
function formulaOf(line: RefundLine, refundFee: number | null): string {
  const paid = formatPrice(line.paid);
  // A duplicate subscription's payment goes back whole.
  if (line.duplicate)
    return `${paid} paid for a duplicate subscription, in full`;
  if (refundFee != null) return `${paid} × (100% − ${refundFee}% refund fee)`;
  if (line.paymentFee == null) return paid;
  const fee = formatPrice(line.paymentFee);
  if (!line.tax) return `${paid} − ${fee} processor fee`;
  const tax = formatPrice(line.tax);
  return `${paid} × (${paid} − ${tax} tax − ${fee} processor fee) ÷ (${paid} − ${tax} tax)`;
}

/**
 * A payment and what a refund sends back of it, one row of a card, four
 * lines: the plan — when, which at what price, the kind, the status; what
 * was paid — the amount, the processor's fee and the tax; how the refund is
 * reckoned under the refund settings; and what it comes to.
 */
export function RefundLineRow({
  line,
  refundFee
}: {
  line: RefundLine;
  /** The refund fee percentage, or null for auto. */
  refundFee: number | null;
}) {
  return (
    <div className="space-y-1.5 px-4 py-3">
      <div className="flex items-center gap-2 text-sm whitespace-nowrap">
        <span className="text-muted-foreground">
          <LocalTime value={line.billedAt} precision="day" />
        </span>
        <span>
          <span className="font-medium">{line.planName}</span>
          <span className="text-muted-foreground">
            {' '}
            {formatPrice(line.price)} / {line.interval}
          </span>
        </span>
        <Badge variant="secondary" className="text-muted-foreground">
          {paymentKindLabelOf(line.kind)}
        </Badge>
        <span className="ml-auto">
          <PaymentStatusBadge status={line.status} />
        </span>
      </div>
      {/* What was paid, a line of its own. */}
      <div className="text-xs text-muted-foreground tabular-nums">
        Paid {formatPrice(line.paid)} · Fee{' '}
        {line.paymentFee == null ? '—' : formatPrice(line.paymentFee)} · Tax{' '}
        {line.tax == null ? '—' : formatPrice(line.tax)}
      </div>
      {/* Set apart from what was paid by a rule. */}
      <div className="!mt-3 space-y-1.5 border-t pt-3">
        {/* How the refund is reckoned, then what it comes to: a line each. */}
        <div className="text-right text-xs text-muted-foreground tabular-nums">
          {formulaOf(line, refundFee)}
        </div>
        <div className="text-right text-sm font-medium tabular-nums">
          Refund {formatPrice(line.left)}
        </div>
      </div>
    </div>
  );
}

/**
 * Whether the refund ends the subscription. Off, it cancels it: it does not
 * renew, and is usable until the end of what was paid for.
 */
export function EndSubscriptionSwitch({
  checked,
  onChange,
  disabled
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center space-x-2">
        <Switch
          id="end-subscription"
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
        />
        <Label htmlFor="end-subscription">End the subscription</Label>
      </div>
      {!checked && (
        <p className="text-xs text-muted-foreground">
          The subscription is canceled: it does not renew, and can be used until
          the end of what was paid for.
        </p>
      )}
    </div>
  );
}
