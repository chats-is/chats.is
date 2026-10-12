import { z } from 'zod';

import {
  BILLING_INTERVALS,
  GRACE_DAYS_CHOICES,
  GRACE_DAYS_DEFAULT,
  PAYMENT_PROCESSORS,
  REFUND_DAYS_CHOICES,
  REFUND_DAYS_DEFAULT,
  REFUND_FEE_OPTIONS,
  REFUND_REQUESTS_CHOICES
} from '@/lib/constant';

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

/** How often a plan is billed: every one day, week, month or year — the
 *  units every processor bills by. */
export const billingIntervalSchema = z.enum(['day', 'week', 'month', 'year']);
export type BillingInterval = z.infer<typeof billingIntervalSchema>;

/** An interval as the pages name it. */
export const billingIntervalOf = (interval: BillingInterval) =>
  BILLING_INTERVALS.find(i => i.value === interval)!;

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
 * - `active` — in effect, and renews at `periodEnd`;
 * - `canceled` — in effect, and ends at `periodEnd`: `canceledAt` says when
 *   it was canceled, `canceledBy` by whom, `reason` why;
 * - `ended` — no longer in effect: `endedAt` says when it ended, `reason`
 *   why.
 *
 * The processors' own statuses are mapped onto these where they are read.
 */
export type SubscriptionStatus = 'active' | 'canceled' | 'ended';
export const subscriptionStatusSchema = z.enum(['active', 'canceled', 'ended']);
/** Why a subscription is `canceled`, or `ended`. */
export type SubscriptionReason =
  | 'canceled_by_customer'
  | 'canceled_by_admin'
  | 'refunded'
  | 'payment_failed'
  | 'payment_disputed'
  | 'duplicate' // a second subscription bought alongside the first
  | 'canceled_in_processor' // cancelled in the payment processor itself
  | 'paused_in_processor'; // paused there, which resuming undoes
/** Whether a subscription was a duplicate: ended, its payments
 *  refunded in full. */
export const isDuplicate = (reason: SubscriptionReason | null | undefined) =>
  reason === 'duplicate';

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

/** A plan is bought at its own price and interval. */
export const checkoutSchema = z.object({ planId: z.string().min(1) });

/** Back from a checkout: which processor, and what its return carried. */
export const confirmCheckoutSchema = z.object({
  via: paymentProcessorSchema,
  ref: z.string().max(255).nullable().optional()
});

/** An upgrade is to a plan at the interval the subscription is billed at. */
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
/** What a payment was for: the one that began the subscription, one that
 *  renewed it, or the difference charged for an upgrade. */
export type PaymentKind = 'initial' | 'renewal' | 'upgrade';
/**
 * A user's request for a refund, which an admin decides on. The user asks;
 * whether money goes back, and how much, is the admin's.
 */
export type RefundRequestStatus = 'pending_approval' | 'approved' | 'rejected';
/** An amount in the processors' integer units (1050), and back (10.50):
 *  amounts are counted in whole units. */
export const toMinor = (amount: number | string) =>
  Math.round(Number(amount) * 100);
export const toAmount = (minor: number) => minor / 100;

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
 * tax)`. Tax that reached the seller with the rest — `sellerTax`, through
 * Stripe — comes to the same: Stripe Tax takes back the tax on a refund in
 * proportion to it, so the seller still owes the tax on what they keep. With
 * no tax in the payment, that is `paid - fee`.
 */
export function refundShareMinor(
  payment: {
    amount: number | string;
    fee: number | string | null;
    tax: number | string | null;
    sellerTax?: number | string | null;
  },
  refundFee: number | null
): number {
  const paid = toMinor(payment.amount);
  if (refundFee != null) return Math.floor((paid * (100 - refundFee)) / 100);
  if (payment.fee == null) return paid;
  const beforeTax =
    paid - toMinor(payment.tax ?? 0) - toMinor(payment.sellerTax ?? 0);
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
    sellerTax?: number | string | null;
  },
  refundFee: number | null
): number {
  return Math.max(
    0,
    refundShareMinor(payment, refundFee) - toMinor(payment.refundAmount)
  );
}

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
  /** End the subscription; otherwise cancel it. */
  endSubscription: z.boolean()
});

/** A user asks for a refund: no amount, only why, if they say. */
export const refundRequestSchema = z.object({
  reason: z.string().trim().max(500).optional()
});

/** An admin approves a refund request: what is left of its payments goes
 *  back, as the refund settings reckon it. */
export const approveRefundRequestSchema = z.object({
  id: z.string().min(1),
  /** End the subscription; otherwise cancel it. */
  endSubscription: z.boolean()
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
