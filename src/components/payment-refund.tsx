import { type RefundRequestStatus } from '@/types/payment';
import { formatPrice } from '@/lib/format-amount';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

type Refunded = {
  refundAmount: string;
  status: string;
  refundByUser?: { name: string | null; email: string } | null;
  /** Set only on a refund sent from here. */
  refundFee?: string | null;
  refundRequest?: { status: RefundRequestStatus } | null;
};

/** How the latest refund of a payment came about: a refund request
 *  approved, an admin's own refund, or one made in the payment processor. */
function sourceOf(payment: Refunded): string {
  const by = payment.refundByUser
    ? (payment.refundByUser.name ?? payment.refundByUser.email)
    : null;
  if (payment.refundRequest) return `Refund request · ${by ?? 'an admin'}`;
  if (by) return `Admin · ${by}`;
  // Sent from here with no admin: a duplicate subscription's, refunded by
  // the app itself.
  if (payment.refundFee != null) return 'Duplicate subscription';
  return 'Payment processor';
}

/**
 * What has gone back of a payment, for its Refunded column: the amount, or
 * nothing when none has. For an admin, how the latest refund came about is
 * its tooltip.
 */
export function RefundedAmount({
  payment,
  showSource = false
}: {
  payment: Refunded;
  showSource?: boolean;
}) {
  const refunded = Number(payment.refundAmount);
  if (refunded <= 0) return null;
  // Money gone back out, in red.
  const amount = (
    <span className="text-red-600 tabular-nums dark:text-red-400">
      {formatPrice(refunded)}
    </span>
  );
  if (!showSource) return amount;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{amount}</TooltipTrigger>
      <TooltipContent>{sourceOf(payment)}</TooltipContent>
    </Tooltip>
  );
}
