import {
  PAYMENT_STATUS_LABELS,
  REFUND_REQUEST_STATUS_LABELS,
  SUBSCRIPTION_REASON_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  type PaymentStatus,
  type RefundRequestStatus,
  type SubscriptionReason,
  type SubscriptionStatus
} from '@/types/payment';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { LocalTime } from '@/components/local-time';

/**
 * What a status means, as a colour, the same wherever a status shows: green
 * done as it should be, amber waiting on someone, red gone wrong, turned
 * down, ended, or money gone back out.
 */
type Tone = 'green' | 'amber' | 'red';

const TONES: Record<Tone, string> = {
  green:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300'
};

const SUBSCRIPTION: Record<SubscriptionStatus, Tone> = {
  active: 'green',
  canceled: 'amber',
  ended: 'red'
};

const PAYMENT: Record<PaymentStatus, Tone> = {
  paid: 'green',
  failed: 'red',
  refund_pending: 'amber',
  refunded: 'red',
  disputed: 'red'
};

const REFUND_REQUEST: Record<RefundRequestStatus, Tone> = {
  pending_approval: 'amber',
  approved: 'green',
  rejected: 'red'
};

/** A status as a tinted badge, no border. */
function ToneBadge({
  tone,
  children
}: {
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <Badge variant="outline" className={cn('border-transparent', TONES[tone])}>
      {children}
    </Badge>
  );
}

/** A subscription's status as a badge: Active, Canceled or Ended. */
export function SubscriptionStatusBadge({
  status
}: {
  status: SubscriptionStatus;
}) {
  return (
    <ToneBadge tone={SUBSCRIPTION[status]}>
      {SUBSCRIPTION_STATUS_LABELS[status]}
    </ToneBadge>
  );
}

type SubscriptionPlace = {
  status: SubscriptionStatus;
  periodEnd: Date | string;
  endedAt?: Date | string | null;
  reason?: SubscriptionReason | null;
};

/**
 * The note beside a subscription's status: the day it renews, the day it
 * ends, or when it ended and — for an admin — why.
 */
export function SubscriptionNote({
  sub,
  showReason = false
}: {
  sub: SubscriptionPlace;
  showReason?: boolean;
}) {
  if (sub.status === 'active') {
    return (
      <>
        Renews on <LocalTime value={sub.periodEnd} precision="day" />
      </>
    );
  }
  if (sub.status === 'canceled') {
    return (
      <>
        Ends on <LocalTime value={sub.periodEnd} precision="day" />
      </>
    );
  }
  return (
    <>
      Ended on <LocalTime value={sub.endedAt!} />
      {showReason &&
        sub.reason &&
        ` · ${SUBSCRIPTION_REASON_LABELS[sub.reason]}`}
    </>
  );
}

/** A subscription's status whole, for an admin: its badge, and its note
 *  under it. */
export function SubscriptionStatus({ sub }: { sub: SubscriptionPlace }) {
  return (
    <div className="space-y-1">
      <SubscriptionStatusBadge status={sub.status} />
      <div className="text-xs whitespace-nowrap text-muted-foreground">
        <SubscriptionNote sub={sub} showReason />
      </div>
    </div>
  );
}

/** A payment's status as a badge. */
export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <ToneBadge tone={PAYMENT[status]}>
      {PAYMENT_STATUS_LABELS[status]}
    </ToneBadge>
  );
}

/** A refund request's status: Pending approval, Approved or Rejected. */
export function RefundRequestStatusBadge({
  status
}: {
  status: RefundRequestStatus;
}) {
  return (
    <ToneBadge tone={REFUND_REQUEST[status]}>
      {REFUND_REQUEST_STATUS_LABELS[status]}
    </ToneBadge>
  );
}

/** A subscription's status for an admin; why an ended one ended is on
 *  hover. */
export function SubscriptionStatusTag({
  sub
}: {
  sub: { status: SubscriptionStatus; reason: SubscriptionReason | null };
}) {
  const badge = <SubscriptionStatusBadge status={sub.status} />;
  if (sub.status !== 'ended' || !sub.reason) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default">{badge}</span>
      </TooltipTrigger>
      <TooltipContent>{SUBSCRIPTION_REASON_LABELS[sub.reason]}</TooltipContent>
    </Tooltip>
  );
}
