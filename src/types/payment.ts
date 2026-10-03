import { z } from 'zod';

import { paginationSchema } from './pagination';

/**
 * Subscriptions: the payment processors, and the subscriptions and payments
 * that come back from them.
 *
 * A plan is the product, with a price of its own and a billing interval. It
 * is sold through one payment processor, chosen on the plan, and names the
 * price that processor knows it by. Taking the money is the processor's
 * business, behind one interface, so another processor is one more entry
 * here and one more adapter on the server.
 */

// ============================================================================
// Processors and prices
// ============================================================================

export const paymentProcessorSchema = z.enum([
  'stripe',
  'paddle',
  'lemonsqueezy'
]);
export type PaymentProcessorId = z.infer<typeof paymentProcessorSchema>;

/** Every processor a plan can be sold through, as the console offers them. */
export const PAYMENT_PROCESSORS: ReadonlyArray<{
  id: PaymentProcessorId;
  label: string;
  /** What the processor calls the ID a plan is sold by. */
  priceIdLabel: string;
  priceIdPlaceholder: string;
  /** Whether a subscription can be upgraded in place, the plan changing
   *  only once the difference is paid. Lemon Squeezy changes the plan
   *  whether or not that charge goes through, so it cannot. */
  upgrades: boolean;
  /** Whether it says what fee it kept on a payment, which a refund on
   *  `auto` goes by. Lemon Squeezy does not. */
  reportsFee: boolean;
}> = [
  {
    id: 'stripe',
    label: 'Stripe',
    priceIdLabel: 'Price ID',
    priceIdPlaceholder: 'price_...',
    upgrades: true,
    reportsFee: true
  },
  {
    id: 'paddle',
    label: 'Paddle',
    priceIdLabel: 'Price ID',
    priceIdPlaceholder: 'pri_...',
    upgrades: true,
    reportsFee: true
  },
  {
    id: 'lemonsqueezy',
    label: 'Lemon Squeezy',
    priceIdLabel: 'Variant ID',
    priceIdPlaceholder: '123456',
    upgrades: false,
    reportsFee: false
  }
];

export const billingIntervalSchema = z.enum(['month', 'year']);
export type BillingInterval = z.infer<typeof billingIntervalSchema>;

/**
 * How a plan is billed: every month, every year, or either, as the user
 * chooses when they subscribe.
 */
export const billingTypeSchema = z.enum(['month', 'year', 'both']);
export type BillingType = z.infer<typeof billingTypeSchema>;

export const BILLING_TYPES: ReadonlyArray<{
  value: BillingType;
  label: string;
}> = [
  { value: 'month', label: 'Monthly' },
  { value: 'year', label: 'Yearly' },
  { value: 'both', label: 'Monthly and Yearly' }
];

/** The intervals a billing type sells at. */
export const intervalsOf = (type: BillingType | null): BillingInterval[] =>
  type === 'both' ? ['month', 'year'] : type ? [type] : [];

/** Every interval a plan can be billed at, as the console offers them. */
export const BILLING_INTERVALS: ReadonlyArray<{
  value: BillingInterval;
  label: string;
}> = [
  { value: 'month', label: 'Monthly' },
  { value: 'year', label: 'Yearly' }
];

/**
 * A price as its processor reports it, as an amount (10.5, not 1050). Read to
 * check a plan's price ID, and to offer the plan its amount.
 */
export type ProcessorPrice = {
  priceId: string;
  amount: number | null;
  interval: BillingInterval | null;
  active: boolean;
  /** Billed by usage rather than a fixed amount. */
  metered: boolean;
  /** The most of it one checkout may buy, where the buyer can choose; null
   *  where the checkout sells exactly one. A plan is sold one at a time. */
  maxQuantity: number | null;
};

export const processorPriceLookupSchema = z.object({
  processor: paymentProcessorSchema,
  priceId: z.string().trim().min(1).max(255)
});

// ============================================================================
// Subscriptions
// ============================================================================

/**
 * A subscription's status, the same whichever processor it is in:
 *
 * - `active` — in effect. It renews at `expiresAt`, or, once cancelled
 *   (`canceledAt` set), is cancelled then;
 * - `canceled` — cancelled: `canceledAt` says when, `cancelReason` why.
 *
 * The processors' own statuses are mapped onto these where they are read.
 */
export type SubscriptionStatus = 'active' | 'canceled';
export const subscriptionStatusSchema = z.enum(['active', 'canceled']);
export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  active: 'Active',
  canceled: 'Canceled'
};

/** Why a subscription was cancelled. */
export type CancelReason =
  | 'canceled_by_customer'
  | 'canceled_by_admin'
  | 'refunded'
  | 'payment_failed'
  | 'payment_disputed'
  | 'duplicate' // a second subscription bought alongside the first
  | 'canceled_in_processor' // cancelled in the payment processor itself
  | 'paused_in_processor'; // paused there, which resuming undoes
/** Whether a subscription was a duplicate: canceled at once, its payments
 *  refunded in full. */
export const isDuplicate = (reason: CancelReason | null | undefined) =>
  reason === 'duplicate';

export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  canceled_by_customer: 'Canceled by customer',
  canceled_by_admin: 'Canceled by admin',
  refunded: 'Refunded',
  payment_failed: 'Payment failed',
  payment_disputed: 'Payment disputed',
  duplicate: 'Duplicate subscription',
  canceled_in_processor: 'Canceled in payment processor',
  paused_in_processor: 'Paused in payment processor'
};

/**
 * Whether a subscription can move to another plan in place: only up — to a
 * plan that costs more, at the same interval, through the same processor,
 * one that upgrades in place. Any other change is made by cancelling and
 * subscribing again once the current subscription has been cancelled.
 */
export function canUpgrade(
  current: { price: number; interval: BillingInterval; processor: string },
  target: { price: number; interval: BillingInterval; processor: string }
): boolean {
  return (
    PAYMENT_PROCESSORS.some(p => p.id === current.processor && p.upgrades) &&
    target.interval === current.interval &&
    target.processor === current.processor &&
    target.price > current.price
  );
}

export const checkoutSchema = z.object({
  planId: z.string().min(1),
  interval: billingIntervalSchema
});

/** Back from a checkout: which processor, and what its return carried. */
export const confirmCheckoutSchema = z.object({
  via: paymentProcessorSchema,
  ref: z.string().max(255).nullable().optional()
});

/** An upgrade keeps the interval the subscription is billed at. */
export const changePlanSchema = z.object({ planId: z.string().min(1) });

// ============================================================================
// Payments
// ============================================================================

/**
 * A payment's status. `refund_pending` is a refund sent and not yet
 * confirmed by the processor; no other refund of it can be made until it is.
 */
export type PaymentStatus =
  'paid' | 'failed' | 'refund_pending' | 'refunded' | 'disputed';
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: 'Paid',
  failed: 'Failed',
  refund_pending: 'Refund pending',
  refunded: 'Refunded',
  disputed: 'Disputed'
};

/** What a payment was for: the one that began the subscription, one that
 *  renewed it, or the difference charged for an upgrade. */
export type PaymentKind = 'initial' | 'renewal' | 'upgrade';
export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  initial: 'Initial',
  renewal: 'Renewal',
  upgrade: 'Upgrade'
};

/**
 * A user's request for a refund, which an admin decides on. The user asks;
 * whether money goes back, and how much, is the admin's.
 */
export type RefundRequestStatus = 'pending_approval' | 'approved' | 'rejected';
export const REFUND_REQUEST_STATUS_LABELS: Record<RefundRequestStatus, string> =
  {
    pending_approval: 'Pending approval',
    approved: 'Approved',
    rejected: 'Rejected'
  };

/** A payment money can still go back from. */
export const REFUNDABLE_STATUSES: ReadonlyArray<PaymentStatus> = ['paid'];

/** An amount in the processors' integer units (1050), and back (10.50):
 *  amounts are counted in whole units. */
export const toMinor = (amount: number | string) =>
  Math.round(Number(amount) * 100);
export const toAmount = (minor: number) => minor / 100;

/**
 * What a refund keeps back of a payment (setting `refunds.fee`): `auto`, the
 * fee the processor kept on it — nothing where the processor does not say
 * its fee — or a percentage of what was paid.
 */
export const REFUND_FEE_PERCENTS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30
] as const;
export const REFUND_FEE_DEFAULT = 'auto';
export const REFUND_FEE_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: 'auto', label: 'Auto' },
  ...REFUND_FEE_PERCENTS.map(p => ({ value: String(p), label: `${p}%` }))
];
export const refundFeeSchema = z
  .string()
  .refine(
    v => REFUND_FEE_OPTIONS.some(o => o.value === v),
    'Auto, or one of the percentages offered.'
  );

/** The refund fee a `refunds.fee` value names: a percentage, or null for
 *  `auto` — also when unset or unknown. */
export function refundFeeOf(value: string | null): number | null {
  if (!value || value === 'auto') return null;
  return refundFeeSchema.safeParse(value).success ? Number(value) : null;
}

/**
 * The share of a payment a refund returns, in whole units, before what has gone
 * back already.
 *
 * With a `refundFee` percentage, what is left of it. Without one — `auto` —
 * the share that leaves the seller where they would be had the
 * payment never been made. A processor keeps its fee on what it refunds; where
 * it also collected the tax, it keeps the fee in proportion to the refund
 * and returns that much of the tax itself. So of `paid`, with `tax` in it,
 * the seller received `paid - tax - fee` and gives back `refund × (paid -
 * tax) / paid`; the two are equal at `paid × (paid - tax - fee) / (paid -
 * tax)`. With no tax in the processor's hands, that is `paid - fee`.
 */
export function refundShareMinor(
  payment: {
    amount: number | string;
    fee: number | string | null;
    tax: number | string | null;
  },
  refundFee: number | null
): number {
  const paid = toMinor(payment.amount);
  if (refundFee != null) return Math.floor((paid * (100 - refundFee)) / 100);
  if (payment.fee == null) return paid;
  const beforeTax = paid - toMinor(payment.tax ?? 0);
  if (beforeTax <= 0) return paid;
  const kept = beforeTax - toMinor(payment.fee);
  return Math.max(0, Math.floor((paid * kept) / beforeTax));
}

/** What is left to refund of a payment under the refund fee, in whole units: its
 *  share less what has gone back already. Never below nothing. */
export function refundLeftMinor(
  payment: {
    amount: number | string;
    refundAmount: number | string;
    fee: number | string | null;
    tax: number | string | null;
  },
  refundFee: number | null
): number {
  return Math.max(
    0,
    refundShareMinor(payment, refundFee) - toMinor(payment.refundAmount)
  );
}

/** How many days after a payment a user may request a refund of it
 *  (`refunds.days`): from 1 to 15, 7 when unset. */
export const REFUND_DAYS_MAX = 15;
export const REFUND_DAYS_DEFAULT = 7;
export const REFUND_DAYS_CHOICES = Array.from(
  { length: REFUND_DAYS_MAX },
  (_, i) => String(i + 1)
);
export const refundDaysSchema = z
  .string()
  .refine(v => REFUND_DAYS_CHOICES.includes(v), 'From 1 to 15 days.');

/** The days a `refunds.days` value names; the default when unset or
 *  unknown. */
export function refundDaysOf(value: string | null): number {
  return value && refundDaysSchema.safeParse(value).success
    ? Number(value)
    : REFUND_DAYS_DEFAULT;
}

/**
 * How many refund requests a user can make on one subscription (setting
 * `refunds.maxRequests`), whatever was decided on them. Unset is no limit.
 * Once used up — the last one rejected — no more can be made.
 */
export const REFUND_REQUESTS_CHOICES = ['1', '2', '3', '4', '5', '6', '7'];
export const refundRequestsSchema = z
  .string()
  .refine(
    v => REFUND_REQUESTS_CHOICES.includes(v),
    'One of the numbers offered, or none for no limit.'
  );

/** The most refund requests a `refunds.maxRequests` value allows, or null
 *  for no limit — when unset, or unknown. */
export function refundRequestsOf(value: string | null): number | null {
  return value && refundRequestsSchema.safeParse(value).success
    ? Number(value)
    : null;
}

/**
 * How many days past its expiry a subscription goes on when its renewal's
 * payment has failed (setting `subscriptions.graceDays`): from 0 to 7, 3
 * when unset. The processor retries the payment meanwhile; still unpaid
 * past these days, the subscription is canceled — however long the
 * processor would have gone on retrying.
 */
export const GRACE_DAYS_MAX = 7;
export const GRACE_DAYS_DEFAULT = 3;
export const GRACE_DAYS_CHOICES = Array.from(
  { length: GRACE_DAYS_MAX + 1 },
  (_, i) => String(i)
);
export const graceDaysSchema = z
  .string()
  .refine(v => GRACE_DAYS_CHOICES.includes(v), 'From 0 to 7 days.');

/** The days a `subscriptions.graceDays` value names; the default when unset
 *  or unknown. */
export function graceDaysOf(value: string | null): number {
  return value && graceDaysSchema.safeParse(value).success
    ? Number(value)
    : GRACE_DAYS_DEFAULT;
}

export const paymentIdSchema = z.object({ id: z.string().min(1) });

/** An admin refunds a payment: all that is left of it, as the refund
 *  settings reckon it. */
export const refundPaymentSchema = z.object({
  paymentId: z.string().min(1),
  /** Cancel the subscription at once; otherwise when it expires. */
  cancelSubscription: z.boolean()
});

/** A user asks for a refund: no amount, only why, if they say. */
export const refundRequestSchema = z.object({
  reason: z.string().trim().max(500).optional()
});

/** An admin approves a refund request: what is left of its payments goes
 *  back, as the refund settings reckon it. */
export const approveRefundRequestSchema = z.object({
  id: z.string().min(1),
  /** Cancel the subscription at once; otherwise when it expires. */
  cancelSubscription: z.boolean()
});

/** An admin rejects a refund request, saying why if they choose to. */
export const rejectRefundRequestSchema = z.object({
  id: z.string().min(1),
  reason: z.string().trim().max(500).optional()
});

// ============================================================================
// Console lists
// ============================================================================

/** The console's subscriptions: by status, by processor, by the user's
 *  name or email. */
export const subscriptionListSchema = z.object({
  ...paginationSchema.shape,
  status: subscriptionStatusSchema.optional(),
  processor: paymentProcessorSchema.optional(),
  q: z.string().trim().max(200).optional()
});

export const subscriptionIdSchema = z.object({ id: z.string().min(1) });

export const paymentStatusSchema = z.enum([
  'paid',
  'failed',
  'refund_pending',
  'refunded',
  'disputed'
]);

/** The console's payments: by status, by processor, by the user's name or
 *  email — or, for a user since deleted, the email the payment kept. */
export const paymentListSchema = z.object({
  ...paginationSchema.shape,
  status: paymentStatusSchema.optional(),
  processor: paymentProcessorSchema.optional(),
  q: z.string().trim().max(200).optional()
});

export const refundRequestListSchema = z.object({
  ...paginationSchema.shape,
  status: z.enum(['pending_approval', 'approved', 'rejected']).optional(),
  q: z.string().trim().max(200).optional()
});
