import '@tanstack/react-start/server-only';

import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL
} from 'drizzle-orm';
import { type z } from 'zod';

import { pageWindow } from '@/types/pagination';
import {
  canUpgrade,
  isDuplicate,
  LIVE_STATUSES,
  REFUNDABLE_STATUSES,
  refundLeftMinor,
  toAmount,
  type approveRefundRequestSchema,
  type BillingInterval,
  type PaymentProcessorId,
  type ProcessorPrice,
  type refundPaymentSchema,
  type refundRequestListSchema,
  type refundRequestSchema,
  type rejectRefundRequestSchema,
  type subscriptionListSchema,
  type SubscriptionReason
} from '@/types/payment';
import { generateUUID } from '@/lib/utils';
import { db } from '@/db';
import {
  payments,
  plans,
  refundRequests,
  subscriptions,
  users
} from '@/db/schema';
import { PublicError } from '@/server/public-error';
import { withLock, type Executor, type Tx } from '@/server/services/db-lock';
import {
  applyRefund,
  attachPayments,
  clearRefundEnd,
  leftToRefundMinor,
  listSubscriptionPayments,
  markDisputed,
  markUndisputed,
  recordPayment,
  refundableMinor,
  startRefund,
  withFee
} from '@/server/services/payment';
import {
  getPaymentProcessor,
  withRetry,
  type ProcessorPayment,
  type ProcessorSubscription,
  type WebhookAction
} from '@/server/services/payment-processor';
import {
  getRefundPolicy,
  getSubscriptionGraceDays,
  getSubscriptionsEnabled
} from '@/server/services/settings';

/**
 * Subscriptions: selling a plan, changing and cancelling it, refunds, and
 * keeping the user's plan in step with what the payment processor says.
 *
 * One flow, whatever the processor. A subscription is `active` while it is
 * in effect and renews, `canceled` while it is in effect and ends at
 * `period_end`, and `ended` once it has stopped:
 *
 * - Subscribing makes it `active`; each renewal moves `period_end` on.
 * - Cancelling — by the user or an admin — makes it `canceled`, with when
 *   (`canceled_at`), by whom (`canceled_by`) and why (`reason`): it ends at
 *   `period_end`. What the user cancelled they can resubscribe until then,
 *   which makes it `active` again; what an admin, a refund or a dispute
 *   cancelled is not theirs to undo.
 * - Upgrading — to a plan that costs more, at the same interval, through
 *   the same processor — starts now and charges the difference; it also
 *   makes a cancellation of the user's own `active` again.
 * - A renewal that fails is retried by the processor. The subscription
 *   keeps its status and its plan to `period_end` and the grace days past
 *   it — one setting, whichever the processor and however long it would go
 *   on retrying. Paid by then, it goes on; still unpaid, it is `ended`
 *   (`ended_at`, `reason`), and ended in the processor, whose retries stop.
 * - A dispute that took the money back, a second subscription bought beside
 *   the first: it is `ended`, with the reason kept.
 * - A user asks for a refund; an admin approves it, or rejects it. An admin
 *   can also refund a payment. Once the money has gone back — wherever the
 *   refund was made — the refund ends the subscription, or cancels it;
 *   while the processor has not confirmed it the subscription is only
 *   `canceled`, and a refund that fails puts it back.
 *
 * The processor's webhooks carry the subscription or the payment as it is
 * there, and that is applied — checked against what is kept, and in the
 * order it happened, so a webhook sent twice, or late, changes nothing. A
 * checkout come back from before its webhook is asked of the processor.
 */

// ============================================================================
// Plans
// ============================================================================

/** What a plan sells for: its price, as an amount. */
const priceOf = (plan: { price: string }) => Number(plan.price);

/** Why a processor's price cannot sell a plan, or null when it can. */
function priceProblem(price: ProcessorPrice): string | null {
  if (!price.active) return 'This price is archived in its payment processor.';
  if (price.metered) return 'This price is billed by usage.';
  if (!price.interval) {
    return 'This price is not billed every day, week, month or year.';
  }
  if (price.amount == null) return 'This price has no fixed amount.';
  if (price.maxQuantity != null && price.maxQuantity > 1) {
    return 'This price lets the buyer choose a quantity. Set its maximum quantity to 1.';
  }
  return null;
}

/**
 * A processor's price read for the plan form, which offers to take its
 * amount into the plan. Refused when it could not sell a plan at all.
 */
export async function lookupProcessorPrice(
  processorId: PaymentProcessorId,
  priceId: string
): Promise<{ price: number; interval: BillingInterval }> {
  const processor = await getPaymentProcessor(processorId);
  const price = await processor.getPrice(priceId);
  const problem = priceProblem(price);
  if (problem) throw new PublicError(problem);
  return { price: price.amount!, interval: price.interval! };
}

type Sale = {
  planId: string;
  processor: PaymentProcessorId;
  interval: BillingInterval;
  price: number;
  priceId: string;
};

/**
 * Check, before money is asked for, that the processor will charge what the
 * plan says. The plan's price is its own, and nothing ties it to the
 * processor but the admin's care; a mismatch is refused rather than charged.
 */
async function requireProcessorAgrees(sale: Sale) {
  const processor = await getPaymentProcessor(sale.processor);
  // Not set up, or not answering: the admin's to read in the log, the
  // user's to be told plainly.
  const price = await processor.getPrice(sale.priceId).catch(err => {
    console.error(`[subscription] ${sale.processor} price check failed`, err);
    throw new PublicError(
      'This plan cannot be bought right now. Please try again later.'
    );
  });
  const agrees =
    !priceProblem(price) &&
    price.interval === sale.interval &&
    Math.round(price.amount! * 100) === Math.round(sale.price * 100);
  if (!agrees) {
    console.error(
      `[subscription] plan ${sale.planId} does not match ${sale.processor} price ${sale.priceId}`,
      price
    );
    throw new PublicError(
      'This plan cannot be bought right now. Please try again later.'
    );
  }
}

/** A plan that can be bought now: open to new subscriptions. */
async function planOnSale(planId: string): Promise<Sale> {
  const plan = await db.query.plans.findFirst({ where: eq(plans.id, planId) });
  if (!plan?.isEnabled) {
    throw new PublicError('This plan is not available.');
  }
  return {
    planId: plan.id,
    processor: plan.processor,
    interval: plan.interval,
    price: priceOf(plan),
    priceId: plan.priceId
  };
}

/** The plan a processor's price belongs to, if any plan has it. The price
 *  IDs are kept on plans only. */
async function planForPrice(
  processor: PaymentProcessorId,
  priceId: string | null,
  ex: Executor = db
): Promise<string | null> {
  if (!priceId) return null;
  const plan = await ex.query.plans.findFirst({
    where: and(eq(plans.processor, processor), eq(plans.priceId, priceId)),
    columns: { id: true }
  });
  return plan?.id ?? null;
}

async function requireSelling() {
  if (!(await getSubscriptionsEnabled())) {
    throw new PublicError('Subscriptions are not available.');
  }
}

/**
 * The plans a user can subscribe to — the enabled ones — with what each
 * costs, how often, and the description its card shows.
 */
export async function listPlansForSale() {
  const rows = await db.query.plans.findMany({
    where: eq(plans.isEnabled, true),
    orderBy: (p, { asc }) => [asc(p.displayOrder), asc(p.name)]
  });

  return rows.map(plan => ({
    id: plan.id,
    name: plan.name,
    description: plan.description,
    interval: plan.interval,
    price: priceOf(plan),
    // Only to tell whether a subscription can upgrade to it in place.
    processor: plan.processor
  }));
}

// ============================================================================
// A user's subscription
// ============================================================================

type SubscriptionRow = typeof subscriptions.$inferSelect;

/** The user's live subscription — `active` or `canceled` — if any: the one
 *  that gives them their plan. */
async function liveSubscription(userId: string, ex: Executor = db) {
  return await ex.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, userId),
      inArray(subscriptions.status, LIVE_STATUSES)
    )
  });
}

async function requireLive(userId: string) {
  const sub = await liveSubscription(userId);
  if (!sub) throw new PublicError('You have no subscription.');
  return sub;
}

/** The user's subscription as their own pages show it. */
export async function getMySubscription(userId: string) {
  const sub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, userId),
      inArray(subscriptions.status, LIVE_STATUSES)
    ),
    with: { plan: true }
  });
  if (!sub) return null;
  const mine = await isOwnToResume(sub);
  const unpaid = await unpaidRenewalOf(sub);
  return {
    id: sub.id,
    planId: sub.planId,
    planName: sub.plan.name,
    interval: sub.plan.interval,
    price: priceOf(sub.plan),
    processor: sub.processor,
    status: sub.status,
    periodEnd: sub.periodEnd,
    // A renewal's payment failed and is being retried: all the user is
    // told of it. How long it may stay unpaid is the app's own to know.
    paymentFailed: !!unpaid,
    // Whether the cancellation is the user's own to undo.
    canResume: sub.status === 'canceled' && mine,
    // Not while a renewal is unpaid: no new charge before that one is paid.
    canUpgrade: mine && !unpaid
  };
}

/**
 * Whether a subscription's renewal — of the period after `period_end` — was
 * reported failed and not paid since: the processor is retrying it. The
 * renewal's invoice says the period it is for; one that does not (Lemon
 * Squeezy) is taken as it stands, since a retry paid later turns that same
 * invoice paid.
 */
const unpaidRenewalWhere = (
  periodEnd: SQL | Date | typeof subscriptions.periodEnd
) =>
  and(
    eq(payments.kind, 'renewal'),
    eq(payments.status, 'failed'),
    or(gt(payments.periodEnd, periodEnd), isNull(payments.periodEnd))
  );

async function unpaidRenewalOf(
  sub: Pick<SubscriptionRow, 'id' | 'periodEnd'>,
  ex: Executor = db
) {
  const row = await ex.query.payments.findFirst({
    where: and(
      eq(payments.subscriptionId, sub.id),
      unpaidRenewalWhere(sub.periodEnd)
    ),
    columns: { id: true }
  });
  return !!row;
}

/** Of these subscriptions, the ones with a renewal unpaid:
 *  `unpaidRenewalOf`, for a page of them at once. */
async function unpaidRenewalsOf(
  subs: Array<Pick<SubscriptionRow, 'id' | 'periodEnd'>>
): Promise<Set<string>> {
  if (subs.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ id: payments.subscriptionId })
    .from(payments)
    .innerJoin(subscriptions, eq(subscriptions.id, payments.subscriptionId))
    .where(
      and(
        inArray(
          payments.subscriptionId,
          subs.map(s => s.id)
        ),
        unpaidRenewalWhere(subscriptions.periodEnd)
      )
    );
  return new Set(rows.map(r => r.id!));
}

/**
 * Until when a subscription whose renewal could not be paid goes on: the
 * grace days past `period_end` — what was paid for, and those days more —
 * the same whichever processor is retrying it. Still unpaid then, it is
 * ended.
 */
async function graceEndOf(periodEnd: Date): Promise<Date> {
  const days = await getSubscriptionGraceDays();
  return new Date(periodEnd.getTime() + days * DAY_MS);
}

/** Whether money has gone back, or is on its way back, of any payment of a
 *  subscription. */
async function refundedOf(subscriptionId: string, ex: Executor = db) {
  const row = await ex.query.payments.findFirst({
    where: and(
      eq(payments.subscriptionId, subscriptionId),
      inArray(payments.status, ['refund_pending', 'refunded'])
    ),
    columns: { id: true }
  });
  return !!row;
}

/**
 * Whether a subscription is its user's own to resume or upgrade: nothing of
 * it has been refunded, and it is `active` — or it was they who canceled
 * it. What an admin, a refund, a dispute or the processor canceled is not
 * theirs to undo.
 */
async function isOwnToResume(row: SubscriptionRow, ex: Executor = db) {
  if (row.status === 'canceled' && row.canceledBy !== row.userId) return false;
  return !(await refundedOf(row.id, ex));
}

/** Where the processor sends the user back to. */
async function appOrigin(request: Request): Promise<string> {
  // Imported here: importing `env` validates the whole environment, and
  // tests reach this module with none.
  const { env } = await import('@/lib/env');
  return env.BETTER_AUTH_URL ?? new URL(request.url).origin;
}

/** The customer a user already is in a processor: that of their latest
 *  subscription there. None, and the checkout makes one. */
async function customerOf(userId: string, processor: PaymentProcessorId) {
  const latest = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, userId),
      eq(subscriptions.processor, processor)
    ),
    orderBy: s => [desc(s.createdAt)],
    columns: { customerId: true }
  });
  return latest?.customerId ?? null;
}

/** What the user is told when the processor cannot open a checkout. */
export const CHECKOUT_FAILED =
  'Checkout could not be opened. Please try again.';

/** Start buying a plan: its processor's checkout page. */
export async function startCheckout(
  user: { id: string; email: string; name: string },
  input: { planId: string },
  request: Request
): Promise<{ url: string }> {
  await requireSelling();
  if (await liveSubscription(user.id)) {
    throw new PublicError(
      'You already have a subscription. You can choose again once it has ended.'
    );
  }
  const sale = await planOnSale(input.planId);
  await requireProcessorAgrees(sale);

  const processor = await getPaymentProcessor(sale.processor);
  const origin = await appOrigin(request);
  try {
    const url = await processor.createCheckout({
      customerId: await customerOf(user.id, sale.processor),
      email: user.email,
      priceId: sale.priceId,
      userId: user.id,
      planId: sale.planId,
      origin,
      // Back to the app, where the plans dialog answers the return — and
      // asks this processor for the subscription if its webhook is late.
      successUrl: `${origin}/?checkout=success&via=${sale.processor}`,
      cancelUrl: `${origin}/?checkout=canceled`
    });
    return { url };
  } catch (err) {
    // Whatever the processor says — not set up, refusing, down — is the
    // admin's to read, in the log; the user is told it plainly.
    console.error(`[subscription] ${sale.processor} checkout failed`, err);
    throw new PublicError(CHECKOUT_FAILED);
  }
}

/**
 * The lock every change to a user's subscriptions takes — the app's own and
 * the processor's webhooks alike — so they happen one at a time.
 */
const userLock = (userId: string) => `subscription:user:${userId}`;

/**
 * Change a subscription the app itself is changing, as one step with the
 * processor: under the user's lock and in one transaction, the row is
 * written, then the processor is asked. A processor that refuses rolls the
 * whole of it back.
 */
async function changeSubscription<T>(
  sub: Pick<SubscriptionRow, 'id' | 'userId'>,
  change: (tx: Tx, row: SubscriptionRow) => Promise<T>
): Promise<T> {
  return await withLock(userLock(sub.userId), async tx => {
    const row = await tx.query.subscriptions.findFirst({
      where: eq(subscriptions.id, sub.id)
    });
    if (!row) throw new PublicError('Subscription not found.');
    return await change(tx, row);
  });
}

/**
 * Upgrade: to a plan that costs more at the interval the subscription is
 * billed at, through the same processor. It starts now and the difference
 * is charged; a canceled subscription is made `active` again, since
 * upgrading is choosing to stay. A charge that fails changes nothing.
 */
export async function upgradePlan(userId: string, input: { planId: string }) {
  await requireSelling();
  const sub = await requireLive(userId);
  if (input.planId === sub.planId) {
    throw new PublicError('You are already on this plan.');
  }
  const current = await db.query.plans.findFirst({
    where: eq(plans.id, sub.planId)
  });
  const target = await planOnSale(input.planId);
  if (
    !current ||
    !canUpgrade(
      {
        price: priceOf(current),
        interval: current.interval,
        processor: sub.processor
      },
      target
    )
  ) {
    throw new PublicError(
      'This plan cannot be switched to in place. To choose it, cancel your subscription and subscribe again once it has ended.'
    );
  }
  await requireProcessorAgrees(target);

  await changeSubscription(sub, async (tx, row) => {
    if (row.status === 'ended') {
      throw new PublicError('This subscription has ended.');
    }
    if (!(await isOwnToResume(row, tx))) {
      throw new PublicError(
        'This subscription has been canceled and cannot be upgraded. You can subscribe again once it has ended.'
      );
    }
    if (await unpaidRenewalOf(row, tx)) {
      throw new PublicError(
        'Your payment failed. Update your payment method before changing your plan.'
      );
    }
    await tx
      .update(subscriptions)
      .set({
        planId: target.planId,
        status: 'active',
        canceledAt: null,
        canceledBy: null,
        reason: null,
        updatedAt: new Date()
      })
      .where(eq(subscriptions.id, row.id));
    const processor = await getPaymentProcessor(row.processor);
    await processor.changeNow(row.externalId, {
      priceId: target.priceId,
      planId: target.planId
    });
  });
  await settlePlan(userId);
}

/**
 * What upgrading to a plan would charge today, as the processor reckons the
 * difference for the rest of the period; null where it cannot say.
 */
export async function previewUpgrade(
  userId: string,
  input: { planId: string }
): Promise<{ amount: number | null }> {
  const sub = await requireLive(userId);
  const target = await planOnSale(input.planId);
  const processor = await getPaymentProcessor(sub.processor);
  const amount = await processor
    .previewChange(sub.externalId, { priceId: target.priceId })
    .catch(err => {
      console.warn(`[subscription] no preview for ${sub.id}`, err);
      return null;
    });
  return { amount };
}

/** Cancel: `canceled`, ending at `period_end` — or `ended`, when what was
 *  paid for has already run out. */
async function cancel(
  sub: SubscriptionRow,
  reason: 'canceled_by_customer' | 'canceled_by_admin',
  by: string
) {
  // A renewal unpaid: what was paid for has already run out, so there is no
  // period left to see out. It is ended, and in the processor, whose
  // retries stop — ended, the user is not charged again.
  if (sub.status !== 'ended' && (await unpaidRenewalOf(sub))) {
    if (!(await endSubscription(sub.id, reason))) {
      throw new PublicError('This subscription has ended.');
    }
    return;
  }
  await changeSubscription(sub, async (tx, row) => {
    if (row.status === 'ended') {
      throw new PublicError('This subscription has ended.');
    }
    if (row.status === 'canceled') {
      throw new PublicError('This subscription is already canceled.');
    }
    await markCanceled(tx, row, reason, by);
  });
}

/** Cancels an `active` subscription: it is not renewed, and is usable until
 *  `period_end`. `by` is who canceled it — the user, an admin — or null
 *  when no one here did. */
async function markCanceled(
  tx: Parameters<Parameters<typeof changeSubscription>[1]>[0],
  row: SubscriptionRow,
  reason: SubscriptionReason,
  by: string | null
) {
  const now = new Date();
  await tx
    .update(subscriptions)
    .set({
      status: 'canceled',
      canceledAt: now,
      canceledBy: by,
      reason,
      updatedAt: now
    })
    .where(eq(subscriptions.id, row.id));
  const processor = await getPaymentProcessor(row.processor);
  await processor.cancel(row.externalId);
}

/**
 * After a refund — once the money has gone back — the subscription is
 * ended, or — the rest of what was paid for left to the user — canceled.
 * One already canceled is left as it is: with a payment of it refunded, it
 * is no longer its user's to resume.
 */
async function endOrCancelRefunded(subscriptionId: string, end: boolean) {
  if (end) {
    await endSubscription(subscriptionId, 'refunded');
    return;
  }
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId)
  });
  if (!sub) return;
  await changeSubscription(sub, async (tx, row) => {
    if (row.status !== 'active') return;
    await markCanceled(tx, row, 'refunded', null);
  });
}

/**
 * While a refund waits for the processor, its subscription is canceled — by
 * the admin who sent it — so it does not renew meanwhile. Nothing is taken
 * from the user yet: confirmed, it ends as the admin chose; failed, it is
 * put back. One already canceled is left as it is.
 */
async function holdForRefund(subscriptionId: string, by: string | null) {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId)
  });
  if (!sub) return;
  await changeSubscription(sub, async (tx, row) => {
    if (row.status !== 'active') return;
    await markCanceled(tx, row, 'refunded', by);
  }).catch(err => {
    // The refund has gone out either way, and its confirmation ends it.
    console.error(`[subscription] could not hold ${subscriptionId}`, err);
  });
}

/**
 * A refund failed. A subscription the refund had canceled, with no other
 * refund of it made or waiting, is `active` again. One canceled before the
 * refund — by its user, or an admin — was never touched, and stays as they
 * left it.
 */
async function releaseRefundHold(subscriptionId: string) {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId)
  });
  if (!sub) return;
  await changeSubscription(sub, async (tx, row) => {
    if (row.status !== 'canceled' || row.reason !== 'refunded') return;
    if (await refundedOf(row.id, tx)) return;
    await tx
      .update(subscriptions)
      .set({
        status: 'active',
        canceledAt: null,
        canceledBy: null,
        reason: null,
        updatedAt: new Date()
      })
      .where(eq(subscriptions.id, row.id));
    const processor = await getPaymentProcessor(row.processor);
    await processor.resume(row.externalId);
  });
}

/** The user cancels their subscription. */
export async function cancelSubscription(userId: string) {
  await cancel(await requireLive(userId), 'canceled_by_customer', userId);
}

/** An admin cancels a subscription: it ends when what was paid for runs
 *  out. */
export async function adminCancelSubscription(id: string, adminId: string) {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, id)
  });
  if (!sub) throw new PublicError('Subscription not found.');
  await cancel(sub, 'canceled_by_admin', adminId);
}

/** Resubscribe: a canceled subscription is `active` again, and renews.
 *  Nothing is charged. The user's alone to do. */
export async function resubscribe(userId: string) {
  const sub = await requireLive(userId);
  await changeSubscription(sub, async (tx, row) => {
    if (row.status !== 'canceled') {
      throw new PublicError('Only a canceled subscription can resume.');
    }
    // Only what the user canceled themselves is theirs to resume.
    if (!(await isOwnToResume(row, tx))) {
      throw new PublicError(
        'This subscription cannot be resumed. You can subscribe again once it has ended.'
      );
    }
    await tx
      .update(subscriptions)
      .set({
        status: 'active',
        canceledAt: null,
        canceledBy: null,
        reason: null,
        updatedAt: new Date()
      })
      .where(eq(subscriptions.id, row.id));
    const processor = await getPaymentProcessor(row.processor);
    await processor.resume(row.externalId);
  });
}

/**
 * End a subscription, with why, and in the processor as near as it allows —
 * a processor that can only end it with the period still has it ended
 * here. False when it had ended already.
 */
async function endSubscription(
  subscriptionId: string,
  reason: SubscriptionReason
): Promise<boolean> {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId),
    columns: { id: true, userId: true }
  });
  if (!sub) return false;
  const ended = await changeSubscription(sub, async (tx, row) => {
    if (row.status === 'ended') return false;
    const now = new Date();
    await tx
      .update(subscriptions)
      .set({
        status: 'ended',
        endedAt: now,
        reason,
        updatedAt: now
      })
      .where(eq(subscriptions.id, row.id));
    const processor = await getPaymentProcessor(row.processor);
    await processor.end(row.externalId);
    return true;
  });
  await settlePlan(sub.userId);
  return ended;
}

/**
 * A payment's money was taken back by a dispute: the customer does not stand
 * by the payment, so the subscription it paid for is ended, here and in the
 * processor, and gives nothing. A dispute won gives the money back,
 * not the subscription: the customer subscribes again if they want it.
 */
async function endDisputed(subscriptionId: string) {
  await endSubscription(subscriptionId, 'payment_disputed');
}

/**
 * How the user's subscription is paid for, as their processor has it now —
 * asked each time it is shown, so a card changed there is the one shown.
 * Null when there is none on file, or the processor cannot say.
 */
export async function getMyPaymentMethod(userId: string) {
  const sub = await liveSubscription(userId);
  if (!sub) return null;
  const processor = await getPaymentProcessor(sub.processor);
  return await processor
    .getPaymentMethod({
      externalId: sub.externalId,
      customerId: sub.customerId
    })
    .catch(err => {
      console.warn(`[subscription] no payment method for ${sub.id}`, err);
      return null;
    });
}

/** The processor's page for changing how the user pays. */
export async function openPaymentMethods(
  userId: string,
  request: Request
): Promise<{ url: string }> {
  const sub = await requireLive(userId);
  const processor = await getPaymentProcessor(sub.processor);
  const url = await processor.paymentMethodsUrl(
    { externalId: sub.externalId, customerId: sub.customerId },
    `${await appOrigin(request)}/`
  );
  return { url };
}

/** The user's plan: that of their live subscription, or none. */
async function settlePlan(userId: string) {
  const sub = await liveSubscription(userId);
  await db
    .update(users)
    .set({ planId: sub?.planId ?? null, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

// ============================================================================
// Keeping in step with the processor
//
// The processor says what happened by webhook, and what it says is applied:
// the subscription or payment it carries, as it is there. Each event says
// when it happened, so one that arrives after a newer one changes nothing,
// and one sent twice changes nothing the second time.
// ============================================================================

/**
 * The user and plan a webhook's object names, checked against what is kept:
 * the checkout wrote them on it, and every processor carries them back. A
 * user not kept, a plan not kept, or a price that is not that plan's is an
 * error — the webhook fails, for the admin to see. A subscription is sold at
 * a price, so it always names one; a payment names it where the processor's
 * invoice carries it, which Lemon Squeezy's does not.
 */
async function requireNamed(
  processorId: PaymentProcessorId,
  named: {
    externalId: string;
    userId: string | null;
    planId: string | null;
    priceId: string | null;
  },
  kind: 'subscription' | 'payment',
  ex: Executor = db
): Promise<{ userId: string; planId: string }> {
  const where = `${processorId} ${named.externalId}`;
  if (!named.userId || !named.planId) {
    throw new Error(`[subscription] ${where} names no user or plan`);
  }
  const user = await ex.query.users.findFirst({
    where: eq(users.id, named.userId),
    columns: { id: true }
  });
  if (!user)
    throw new Error(`[subscription] ${where}: no user ${named.userId}`);
  const plan = await ex.query.plans.findFirst({
    where: eq(plans.id, named.planId),
    columns: { id: true, processor: true, priceId: true }
  });
  if (!plan)
    throw new Error(`[subscription] ${where}: no plan ${named.planId}`);
  if (kind === 'subscription' && !named.priceId) {
    throw new Error(`[subscription] ${where} names no price`);
  }
  // The price, where the processor says it, must be this plan's.
  if (
    named.priceId &&
    (plan.processor !== processorId || plan.priceId !== named.priceId)
  ) {
    throw new Error(
      `[subscription] ${where}: price ${named.priceId} is not plan ${plan.id}'s`
    );
  }
  return { userId: user.id, planId: plan.id };
}

/**
 * Keep a subscription as a webhook says it is, under its user's lock.
 *
 * - New and in effect: kept, and the user has its plan; payments of it
 *   reported first are attached. A user with another live subscription
 *   already has it kept as `ended`, a duplicate, and its payment refunded.
 * - `canceled`: canceled, with the reason the app gave — or, canceled in
 *   the processor, `canceled_in_processor`.
 * - `ended`: ended at `period_end`, when it was canceled and that has come
 *   — or now, because its payment failed or it was ended in the processor.
 *
 * `ended` is final: a subscription ended here stays so, whatever the
 * processor goes on saying. One not paid for yet is not kept.
 *
 * The webhook names the user and plan the checkout wrote on it, and those
 * find the record: the user's own subscription through this processor, the
 * processor's id telling which of theirs.
 */
async function applySubscription(
  processorId: PaymentProcessorId,
  snap: ProcessorSubscription
) {
  const { externalId } = snap;
  const named = await requireNamed(processorId, snap, 'subscription');
  const { userId } = named;

  const outcome = await withLock(userLock(userId), async tx => {
    const was = await subscriptionOf(tx, processorId, userId, externalId);
    if (snap.status === 'incomplete') return null;
    // Paused in the processor and resumed there: in effect again, unless
    // the user has another by now.
    const resumed =
      was?.status === 'ended' &&
      was.reason === 'paused_in_processor' &&
      (snap.status === 'active' || snap.status === 'canceled') &&
      !(await liveSubscription(userId, tx));
    if (was?.status === 'ended' && !resumed) {
      // Ended here stays so. One the processor still keeps going — resumed
      // there, or still retrying a payment — is ended there.
      return aliveIn(snap) ? { userId, endThere: true } : null;
    }
    if (!was && snap.status === 'ended') return null;

    const { planId } = named;
    const now = new Date();
    // The period end is written once, when the subscription is made. From
    // then on it moves only when a renewal is paid — the payment's webhook
    // says so — never on the processor's word alone: a processor counts the
    // next period from the moment it bills it, paid or not.
    const periodEnd = was?.periodEnd ?? snap.periodEnd ?? now;

    let status: SubscriptionRow['status'] = 'active';
    let canceledAt: Date | null = null;
    let canceledBy: string | null = null;
    let endedAt: Date | null = null;
    let reason: SubscriptionReason | null = null;
    // Canceled here, not by its user — by an admin, a refund, a dispute —
    // and renewing again in the processor, resumed there: the cancellation
    // stands, and is made there again. One the processor canceled is the
    // processor's to undo.
    const relock =
      snap.status === 'active' &&
      was?.status === 'canceled' &&
      was.reason !== 'canceled_in_processor' &&
      !(await isOwnToResume(was, tx));
    if (snap.status === 'canceled') {
      status = 'canceled';
      canceledAt = was?.canceledAt ?? now;
      canceledBy = was?.canceledBy ?? null;
      reason = was?.reason ?? 'canceled_in_processor';
    } else if (relock) {
      status = 'canceled';
      canceledAt = was.canceledAt;
      canceledBy = was.canceledBy;
      reason = was.reason;
    } else if (snap.status === 'ended') {
      // Canceled, and its period end has come: ended then. Ended before
      // that — stopped early in the processor — ended now, when it really
      // ended.
      const due = was?.status === 'canceled' && was.periodEnd <= now;
      status = 'ended';
      canceledAt = was?.canceledAt ?? null;
      canceledBy = was?.canceledBy ?? null;
      endedAt = due ? was.periodEnd : now;
      reason = snap.paused
        ? 'paused_in_processor'
        : (was?.reason ?? 'canceled_in_processor');
    }

    if (was) {
      await tx
        .update(subscriptions)
        .set({
          planId,
          status,
          periodEnd,
          canceledAt,
          canceledBy,
          endedAt,
          reason,
          updatedAt: now
        })
        .where(eq(subscriptions.id, was.id));
      return { userId, relock };
    }

    // Two checkouts finished side by side: the first bought stays.
    const duplicate = !!(await liveSubscription(userId, tx));
    const id = generateUUID();
    await tx.insert(subscriptions).values({
      id,
      userId,
      planId,
      processor: processorId,
      externalId,
      customerId: snap.customerId,
      status: duplicate ? 'ended' : status,
      periodEnd,
      canceledAt,
      canceledBy,
      endedAt: duplicate ? now : endedAt,
      reason: duplicate ? 'duplicate' : reason
    });
    await attachPayments(processorId, userId, externalId, id, tx);
    return { userId, duplicate: duplicate ? id : null, endThere: duplicate };
  });
  if (!outcome) return;
  await settlePlan(outcome.userId);

  const processor = await getPaymentProcessor(processorId);
  if (outcome.endThere) {
    await withRetry(() => processor.end(externalId));
  } else if (outcome.relock) {
    await withRetry(() => processor.cancel(externalId));
  }
  if (outcome.duplicate) await refundDuplicate(outcome.duplicate);
}

/** Whether the processor still keeps a subscription going: `active` and
 *  renewing, or retrying a payment that failed. */
function aliveIn(snap: ProcessorSubscription): boolean {
  return snap.status === 'active' || snap.paymentFailed;
}

/**
 * A duplicate — a second subscription bought beside the one a user has — is
 * kept canceled, giving nothing, cancelled in the processor, and its
 * payments refunded in full. Here, the refunds: of every payment of it that
 * is paid and not refunded.
 */
async function refundDuplicate(subscriptionId: string) {
  const rows = await db.query.payments.findMany({
    where: and(
      eq(payments.subscriptionId, subscriptionId),
      eq(payments.status, 'paid')
    )
  });
  for (const row of rows) {
    try {
      await startRefund(row.id, refundableMinor(row, null, true), {
        adminId: null,
        retry: true
      });
    } catch (err) {
      // Left paid, for an admin to refund from Payments.
      console.error(`[payment] could not refund duplicate's ${row.id}`, err);
    }
  }
}

/** A user's subscription through a processor, the one the processor's id
 *  names among theirs. */
async function subscriptionOf(
  ex: Executor,
  processorId: PaymentProcessorId,
  userId: string,
  externalId: string
) {
  return await ex.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, userId),
      eq(subscriptions.processor, processorId),
      eq(subscriptions.externalId, externalId)
    )
  });
}

/**
 * A payment a webhook reports, kept as the invoice says, for the user and
 * plan it names — and for the user's subscription it belongs to, when that
 * is kept; attached once the subscription arrives otherwise.
 *
 * A renewal paid moves the subscription on to the period it paid for. One
 * not paid is kept so, and the subscription goes on through its grace days
 * — the processor retrying meanwhile; a failure reported once those are
 * over ends it.
 */
async function applyPayment(
  processorId: PaymentProcessorId,
  payment: ProcessorPayment
) {
  if (!payment.externalSubscriptionId) return;
  const externalSubscriptionId = payment.externalSubscriptionId;
  const { userId, planId } = await requireNamed(
    processorId,
    payment,
    'payment'
  );
  // A renewal paid buys the period up to the subscription's next renewal.
  // A processor whose invoice does not say so (Lemon Squeezy) says it on the
  // subscription, which is read for it.
  if (payment.kind === 'renewal' && payment.paid && !payment.periodEnd) {
    const processor = await getPaymentProcessor(processorId);
    const snap = await processor.getSubscription(externalSubscriptionId);
    payment = { ...payment, periodEnd: snap.periodEnd };
  }
  // Under the user's lock, as the subscription's webhook is: the two arrive
  // together, and whichever is second sees the first.
  const { sub, row } = await withLock(userLock(userId), async tx => {
    const sub = await subscriptionOf(
      tx,
      processorId,
      userId,
      externalSubscriptionId
    );
    const row = await recordPayment(
      processorId,
      payment,
      { userId, planId, subscriptionId: sub?.id ?? null },
      tx
    );
    return { sub, row };
  });
  if (!sub) return;
  if (isDuplicate(sub.reason)) {
    await refundDuplicate(sub.id);
    return;
  }
  if (payment.kind !== 'renewal') return;
  if (payment.paid) {
    await renew(sub.id, row);
  } else if (
    sub.status !== 'ended' &&
    (await graceEndOf(sub.periodEnd)) <= new Date()
  ) {
    // Still unpaid past the grace days: over, and the processor's retries
    // with it.
    await endSubscription(sub.id, 'payment_failed');
  }
}

/**
 * A renewal paid: the subscription goes on to the end of the period it paid
 * for. Canceled, it ends then.
 */
async function renew(
  subscriptionId: string,
  paid: typeof payments.$inferSelect
) {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId),
    columns: { id: true, userId: true }
  });
  if (!sub) return;
  if (!paid.periodEnd) {
    throw new Error(`[payment] ${paid.id} says no period it paid for`);
  }
  const periodEnd = paid.periodEnd;
  await changeSubscription(sub, async (tx, row) => {
    if (row.status === 'ended') return;
    if (periodEnd <= row.periodEnd) return;
    await tx
      .update(subscriptions)
      .set({
        periodEnd,
        updatedAt: new Date()
      })
      .where(eq(subscriptions.id, row.id));
  });
}

// ============================================================================
// Asking the processor
//
// Two things are read from the processor rather than told by webhook: what
// a checkout the user came back from made, when its webhook has not said;
// and, by the scheduled job, whether a subscription past its period end
// still runs. Both are kept as a webhook saying the same would have kept them.
// ============================================================================

/**
 * The user is back from a checkout and no subscription has arrived: the
 * processor is asked for what the checkout made, and it is kept as a
 * webhook would have kept it. Nothing found, or the processor not
 * answering, changes nothing — the webhook may still come.
 */
export async function confirmCheckout(
  user: { id: string; email: string },
  input: { via: PaymentProcessorId; ref?: string | null }
) {
  if (await liveSubscription(user.id)) return;
  try {
    const processor = await getPaymentProcessor(input.via);
    const found = await processor.findSubscriptions({
      ref: input.ref ?? null,
      userId: user.id,
      email: user.email
    });
    for (const externalId of found) {
      if (await subscriptionOf(db, input.via, user.id, externalId)) continue;
      const snap = await processor.getSubscription(externalId);
      await applySubscription(input.via, {
        ...snap,
        userId: snap.userId ?? user.id,
        planId: snap.planId ?? (await planForPrice(input.via, snap.priceId))
      });
    }
  } catch (err) {
    console.warn(`[subscription] ${input.via} checkout not confirmed`, err);
  }
}

/** How long past its period end a subscription is left for its renewal's
 *  webhook, before the job asks the processor about it. */
const EXPIRY_GRACE_MS = 60 * 60 * 1000;

/** How long a refund sent from here is left for its webhook, before the job
 *  asks the processor about it. */
const REFUND_WAIT_MS = 24 * 60 * 60 * 1000;

/** How many of each one run takes, so a run ends in time. */
const RECONCILE_BATCH = 100;

/**
 * The scheduled job: the recovery for what the webhooks did not say, kept
 * apart from the flow they drive. Three things, each where money and
 * service would otherwise part:
 *
 * 1. A subscription past its period end and still live, with no renewal
 *    reported failed: its renewal's or its end's webhook has not come. The processor is asked for the subscription, and it is kept as
 *    that webhook would have kept it.
 * 2. A subscription whose renewal was reported failed and whose grace days
 *    are over, the processor's next retry not reported yet: ended, here and
 *    there, as the next failure would have ended it.
 * 3. A refund sent from here and still waiting after a day: the processor
 *    is asked for that refund, by its id, and it is applied as its webhook
 *    would have been.
 *
 * One that cannot be read is left for the next run.
 */
export async function runScheduledJob(): Promise<{
  expired: number;
  unpaid: number;
  refunds: number;
  failed: number;
}> {
  const now = new Date();
  let failed = 0;

  // 1 and 2. Subscriptions past their period end and still live, each with
  // whether the renewal of the period after it was reported failed:
  // one query, one pass. The renewal's invoice says the period it is for;
  // one that does not (Lemon Squeezy) is taken as it stands — a retry paid
  // later turns that same invoice paid.
  const unpaidRenewal = db
    .select({ subscriptionId: payments.subscriptionId })
    .from(payments)
    .where(
      and(
        eq(payments.subscriptionId, subscriptions.id),
        unpaidRenewalWhere(subscriptions.periodEnd)
      )
    );
  const expired = await db
    .select({
      id: subscriptions.id,
      processor: subscriptions.processor,
      externalId: subscriptions.externalId,
      userId: subscriptions.userId,
      planId: subscriptions.planId,
      periodEnd: subscriptions.periodEnd,
      unpaid: sql<boolean>`exists ${unpaidRenewal}`
    })
    .from(subscriptions)
    .where(
      and(
        inArray(subscriptions.status, LIVE_STATUSES),
        lt(subscriptions.periodEnd, new Date(now.getTime() - EXPIRY_GRACE_MS))
      )
    )
    .orderBy(subscriptions.updatedAt)
    .limit(RECONCILE_BATCH);
  const graceDays = await getSubscriptionGraceDays();
  let asked = 0;
  let ended = 0;
  for (const sub of expired) {
    try {
      if (sub.unpaid) {
        // A renewal failed: ended once the grace days are over.
        if (sub.periodEnd.getTime() + graceDays * DAY_MS <= now.getTime()) {
          await endSubscription(sub.id, 'payment_failed');
          ended++;
        }
        continue;
      }
      // Nothing heard: the processor is asked.
      asked++;
      const processor = await getPaymentProcessor(sub.processor);
      const snap = await processor.getSubscription(sub.externalId);
      // Read, not told: a processor's API may not carry the checkout's
      // custom data, which the kept row has.
      await applySubscription(sub.processor, {
        ...snap,
        userId: snap.userId ?? sub.userId,
        planId: snap.planId ?? sub.planId
      });
    } catch (err) {
      failed++;
      console.error(`[reconcile] subscription ${sub.id}`, err);
    }
  }

  // 3. Refunds sent from here, a day on and still waiting.
  const waiting = await db.query.payments.findMany({
    where: and(
      eq(payments.status, 'refund_pending'),
      isNotNull(payments.externalRefundId),
      isNotNull(payments.transactionId),
      lt(payments.refundAt, new Date(now.getTime() - REFUND_WAIT_MS))
    ),
    orderBy: p => [p.refundAt],
    limit: RECONCILE_BATCH
  });
  for (const row of waiting) {
    try {
      const processor = await getPaymentProcessor(row.processor);
      const refund = await processor.getRefund(row, row.externalRefundId!);
      await dispatch(row.processor, {
        kind: 'refund',
        transactionId: row.transactionId!,
        refund
      });
    } catch (err) {
      failed++;
      console.error(`[reconcile] refund of ${row.id}`, err);
    }
  }
  return {
    expired: asked,
    unpaid: ended,
    refunds: waiting.length,
    failed
  };
}

/** One webhook call: its signature checked, then what it asks for done. */
export async function handleWebhook(
  processorId: PaymentProcessorId,
  payload: string,
  headers: Headers
) {
  const processor = await getPaymentProcessor(processorId);
  const event = await processor.parseWebhook(payload, headers);
  await dispatch(processorId, event.action);
}

async function dispatch(
  processorId: PaymentProcessorId,
  action: WebhookAction
) {
  switch (action.kind) {
    case 'subscription':
      await applySubscription(processorId, action.subscription);
      return;
    case 'payment':
      await applyPayment(processorId, action.payment);
      return;
    case 'refund': {
      const done = await applyRefund(
        processorId,
        action.transactionId,
        action.refund,
        { userId: action.userId ?? null, planId: action.planId ?? null }
      );
      if (!done) return;
      if (done.failed) {
        if (done.subscriptionId) await releaseRefundHold(done.subscriptionId);
        if (done.refundRequestId) await reopenRequest(done.refundRequestId);
        return;
      }
      await afterRefund(done);
      return;
    }
    case 'dispute': {
      const row = await markDisputed(processorId, action.transactionId);
      // An inquiry only marks the payment: the money has not left.
      if (action.withdrawn && row.subscriptionId) {
        await endDisputed(row.subscriptionId);
      }
      return;
    }
    case 'dispute_won':
      await markUndisputed(processorId, action.transactionId);
      return;
    case 'ignore':
      return;
  }
}

/**
 * Money has gone back of a payment: what it paid for stops. A duplicate's
 * was to go back; any other subscription is ended, or canceled, as the
 * refund owes it — and only then is that owed no more, so a webhook sent
 * again after a failure does it.
 */
async function afterRefund(
  done: NonNullable<Awaited<ReturnType<typeof applyRefund>>>
) {
  if (!done.subscriptionId || done.endSubscription == null) return;
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, done.subscriptionId),
    columns: { reason: true }
  });
  if (!isDuplicate(sub?.reason)) {
    await endOrCancelRefunded(done.subscriptionId, done.endSubscription);
  }
  await clearRefundEnd(done.paymentId);
}

/** A refund approved for a request failed: the request waits to be decided
 *  again — unless the user has asked anew meanwhile. */
async function reopenRequest(requestId: string) {
  await db
    .update(refundRequests)
    .set({ status: 'pending_approval' })
    .where(
      and(
        eq(refundRequests.id, requestId),
        eq(refundRequests.status, 'approved')
      )
    )
    .catch(err => {
      console.warn(`[subscription] request ${requestId} not reopened`, err);
    });
}

// ============================================================================
// Refund requests
// ============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The payments of a subscription a refund request made at `at` covers:
 * made within the refund window before it, with money left to go back.
 * Each with what the refund fee leaves of it — the estimate the user sees,
 * and what approving it refunds.
 */
async function refundablePayments(
  subscriptionId: string,
  policy: Awaited<ReturnType<typeof getRefundPolicy>>,
  at: Date
) {
  const rows = await db.query.payments.findMany({
    where: and(
      eq(payments.subscriptionId, subscriptionId),
      inArray(payments.status, [...REFUNDABLE_STATUSES]),
      gte(payments.billedAt, new Date(at.getTime() - policy.days * DAY_MS))
    ),
    orderBy: p => [p.billedAt],
    with: { plan: true }
  });
  const covered = await Promise.all(
    rows
      .filter(p => p.billedAt <= at)
      .map(async ({ plan, ...p }) => {
        const payment = await withFee(p, policy.refundFee);
        return {
          payment,
          plan,
          left: leftToRefundMinor(payment, policy.refundFee),
          estimate: refundLeftMinor(payment, policy.refundFee)
        };
      })
  );
  return covered.filter(c => c.left > 0);
}

/**
 * One payment as a refund shows it, the same in the refund of a payment
 * and in the review of a refund request: when it was paid, for which plan
 * at what price, and
 * where its money stands — what was paid, the processor's fee and the tax
 * in it, what has gone back, and what is left to refund under the refund
 * fee — what a refund of it sends.
 */
function refundLineOf(
  payment: typeof payments.$inferSelect,
  plan: { name: string; price: string; interval: BillingInterval },
  left: number,
  duplicate = false
) {
  return {
    id: payment.id,
    billedAt: payment.billedAt,
    planName: plan.name,
    // What the plan is billed at.
    price: priceOf(plan),
    interval: plan.interval,
    kind: payment.kind,
    status: payment.status,
    paid: Number(payment.amount),
    paymentFee: payment.fee == null ? null : Number(payment.fee),
    tax: payment.tax == null ? null : Number(payment.tax),
    refunded: Number(payment.refundAmount),
    left: toAmount(left),
    // A duplicate's payment, which goes back whole whatever the refund fee.
    duplicate
  };
}

/**
 * What the user sees before asking for a refund: whether they can, and if
 * not why; the rules as the settings have them; and the estimate. Also the
 * latest request on the subscription, so the page can say where it stands.
 */
export async function getMyRefundRequest(userId: string) {
  return (await refundOffer(userId))?.offer ?? null;
}

/** The refund offer, with the subscription and the policy it was read
 *  under, for asking without reading them again. */
async function refundOffer(userId: string) {
  const [policy, sub] = await Promise.all([
    getRefundPolicy(),
    liveSubscription(userId)
  ]);
  if (!sub) return null;
  const requests = await db.query.refundRequests.findMany({
    where: eq(refundRequests.subscriptionId, sub.id),
    orderBy: r => [desc(r.createdAt)],
    columns: {
      id: true,
      status: true,
      reason: true,
      rejectionReason: true,
      createdAt: true
    }
  });
  const latest = requests[0] ?? null;
  // How many more requests this subscription can have; null for no limit.
  const requestsLeft =
    policy.maxRequests == null
      ? null
      : Math.max(0, policy.maxRequests - requests.length);
  const plan = await db.query.plans.findFirst({
    where: eq(plans.id, sub.planId),
    columns: { name: true }
  });
  const covered = policy.enabled
    ? await refundablePayments(sub.id, policy, new Date())
    : [];
  const estimate = covered.reduce((sum, c) => sum + c.estimate, 0);

  let unavailable: string | null = null;
  if (!policy.enabled) unavailable = 'Refunds are not available.';
  else if (latest?.status === 'pending_approval') {
    unavailable = 'Your refund request is being reviewed.';
  } else if (requestsLeft === 0) {
    unavailable =
      'Your refund request was rejected, and no more can be made for this subscription.';
  } else if (sub.periodEnd <= new Date()) {
    // What was paid for has run out — a renewal unpaid, say: nothing of it
    // is left to ask back.
    unavailable =
      'Refunds can be requested only before your subscription ends.';
  } else if (covered.length === 0) {
    unavailable = `Refunds can be requested within ${policy.days} days of a payment.`;
  }

  const offer = {
    canRequest: unavailable == null,
    unavailable,
    latest,
    rules: {
      enabled: policy.enabled,
      days: policy.days,
      // The refund fee: a percentage, or null for the processor's own fee.
      refundFee: policy.refundFee,
      requestsLeft,
      planName: plan?.name ?? null
    },
    payments: covered.map(c => ({
      id: c.payment.id,
      kind: c.payment.kind,
      amount: Number(c.payment.amount),
      billedAt: c.payment.billedAt,
      estimate: toAmount(c.estimate)
    })),
    estimate: toAmount(estimate)
  };
  return { offer, sub, policy };
}

/**
 * The user asks for a refund of their subscription: a request with no
 * amount, which an admin decides on. Their subscription stays as it is
 * meanwhile.
 */
export async function submitRefundRequest(
  userId: string,
  input: z.infer<typeof refundRequestSchema>
) {
  const read = await refundOffer(userId);
  if (!read?.offer.canRequest) {
    throw new PublicError(
      read?.offer.unavailable ?? 'You have no subscription.'
    );
  }
  const { sub } = read;
  const { maxRequests } = read.policy;
  // Under the subscription's lock, so two at once make one request.
  await withLock(`refund-request:${sub.id}`, async tx => {
    const earlier = await tx.query.refundRequests.findMany({
      where: eq(refundRequests.subscriptionId, sub.id),
      columns: { status: true }
    });
    if (earlier.some(r => r.status === 'pending_approval')) {
      throw new PublicError('Your refund request is being reviewed.');
    }
    if (maxRequests != null && earlier.length >= maxRequests) {
      throw new PublicError(
        'Your refund request was rejected, and no more can be made for this subscription.'
      );
    }
    await tx.insert(refundRequests).values({
      id: generateUUID(),
      userId,
      subscriptionId: sub.id,
      status: 'pending_approval',
      reason: input.reason || null
    });
  });
}

/** One page of refund requests, newest first, by status; with how many
 *  wait to be decided. */
export async function listRefundRequests(
  filter: z.infer<typeof refundRequestListSchema>
) {
  const term = filter.q?.trim();
  const where = and(
    filter.status ? eq(refundRequests.status, filter.status) : undefined,
    term
      ? inArray(
          refundRequests.userId,
          db
            .select({ id: users.id })
            .from(users)
            .where(
              or(
                ilike(users.name, `%${term}%`),
                ilike(users.email, `%${term}%`)
              )
            )
        )
      : undefined
  );
  const [rows, [totalRow], [pendingRow]] = await Promise.all([
    db.query.refundRequests.findMany({
      where,
      ...pageWindow(filter),
      orderBy: r => [desc(r.createdAt), desc(r.id)],
      with: {
        user: { columns: { id: true, name: true, email: true } },
        subscription: {
          columns: {
            status: true,
            processor: true,
            periodEnd: true,
            endedAt: true
          },
          with: { plan: { columns: { name: true } } }
        },
        // The payments its approval refunded.
        payments: { columns: { refundAmount: true, status: true } }
      }
    }),
    db.select({ count: count() }).from(refundRequests).where(where),
    db
      .select({ count: count() })
      .from(refundRequests)
      .where(eq(refundRequests.status, 'pending_approval'))
  ]);
  return {
    rows: rows.map(({ payments: refunded, ...request }) => ({
      ...request,
      // What has gone back of its payments, and whether any of it still
      // waits for the processor.
      refunded: refunded.reduce((sum, p) => sum + Number(p.refundAmount), 0),
      refundPending: refunded.some(p => p.status === 'refund_pending')
    })),
    total: Number(totalRow?.count ?? 0),
    pendingApproval: Number(pendingRow?.count ?? 0),
    page: filter.page,
    pageSize: filter.pageSize
  };
}

/**
 * A refund request as an admin decides on it: who asked, why, and each
 * payment it covers — as they were when the user asked — with what was
 * paid, the processor's fee, what has gone back, what is left, and what
 * the refund fee suggests.
 */
export async function getRefundRequest(id: string) {
  const request = await db.query.refundRequests.findFirst({
    where: eq(refundRequests.id, id),
    with: {
      user: { columns: { id: true, name: true, email: true } },
      subscription: { with: { plan: { columns: { name: true } } } }
    }
  });
  if (!request) throw new PublicError('Refund request not found.');
  const policy = await getRefundPolicy();
  const covered = await refundablePayments(
    request.subscriptionId,
    policy,
    request.createdAt
  );
  return {
    id: request.id,
    status: request.status,
    reason: request.reason,
    rejectionReason: request.rejectionReason,
    createdAt: request.createdAt,
    user: request.user,
    subscription: {
      id: request.subscription.id,
      status: request.subscription.status,
      planName: request.subscription.plan.name,
      processor: request.subscription.processor
    },
    refundFee: policy.refundFee,
    payments: covered.map(c =>
      refundLineOf(c.payment, c.plan, Math.min(c.estimate, c.left))
    )
  };
}

/**
 * An admin approves a refund request: what is left of each payment it
 * covers goes back, as the refund settings reckon it, and the subscription
 * is ended, or canceled, once the processor confirms the money went back,
 * as a refund from Payments does. Claimed first, so
 * two admins at once approve it once; if no refund goes out, or it fails
 * later, it is left to be decided again.
 */
export async function approveRefundRequest(
  input: z.infer<typeof approveRefundRequestSchema>,
  adminId: string
) {
  const [claimed] = await db
    .update(refundRequests)
    .set({ status: 'approved' })
    .where(
      and(
        eq(refundRequests.id, input.id),
        eq(refundRequests.status, 'pending_approval')
      )
    )
    .returning();
  if (!claimed) {
    throw new PublicError('This refund request has already been decided.');
  }

  const policy = await getRefundPolicy();
  const covered = await refundablePayments(
    claimed.subscriptionId,
    policy,
    claimed.createdAt
  );
  // Refunded already — from Payments, say: approved, with nothing more to
  // send, and the subscription as that refund left it.
  if (covered.length === 0) return;
  let sent = 0;
  let failure: unknown = null;
  for (const c of covered) {
    try {
      await startRefund(
        c.payment.id,
        c.left,
        {
          adminId,
          requestId: claimed.id,
          endSubscription: input.endSubscription
        },
        { refundFee: policy.refundFee }
      );
      sent++;
    } catch (err) {
      failure = err;
      break;
    }
  }

  if (sent === 0) {
    // Nothing went out: the request waits to be decided again.
    await db
      .update(refundRequests)
      .set({ status: 'pending_approval' })
      .where(eq(refundRequests.id, claimed.id));
    throw failure ?? new PublicError('Nothing was refunded.');
  }
  await holdForRefund(claimed.subscriptionId, adminId);
  if (failure) {
    throw new PublicError(
      `Approved, but not every refund went out: ${failure instanceof Error ? failure.message : 'a refund failed'}. Refund the rest from Payments.`
    );
  }
}

/** An admin rejects a refund request; the subscription stays as it is. */
export async function rejectRefundRequest(
  input: z.infer<typeof rejectRefundRequestSchema>
) {
  const [rejected] = await db
    .update(refundRequests)
    .set({ status: 'rejected', rejectionReason: input.reason || null })
    .where(
      and(
        eq(refundRequests.id, input.id),
        eq(refundRequests.status, 'pending_approval')
      )
    )
    .returning();
  if (!rejected) {
    throw new PublicError('This refund request has already been decided.');
  }
}

// ============================================================================
// An admin, from a payment
// ============================================================================

/**
 * A payment as an admin acts on it from Payments: what was paid, the
 * processor's fee and the tax in it, what has gone back, what is left, what
 * the refund fee suggests, and the subscription it paid for.
 */
export async function getRefundDetails(paymentId: string) {
  const [row, policy] = await Promise.all([
    db.query.payments.findFirst({
      where: eq(payments.id, paymentId),
      with: {
        plan: true,
        user: { columns: { id: true, name: true, email: true } },
        subscription: { with: { plan: { columns: { name: true } } } }
      }
    }),
    getRefundPolicy()
  ]);
  if (!row) throw new PublicError('Payment not found.');
  const { subscription, plan, user, ...rest } = row;
  const payment = await withFee(rest, policy.refundFee);
  const duplicate = isDuplicate(subscription?.reason);
  return {
    user,
    userEmail: payment.userEmail,
    processor: payment.processor,
    refundFee: policy.refundFee,
    payment: refundLineOf(
      payment,
      plan,
      refundableMinor(payment, policy.refundFee, duplicate),
      duplicate
    ),
    subscription: subscription
      ? { planName: subscription.plan.name, status: subscription.status }
      : null
  };
}

/**
 * An admin refunds a payment — whether or not users may request refunds —
 * of all that is left of it, as the refund settings reckon it. The
 * subscription it paid for is canceled meanwhile and, when the processor
 * confirms the money went back, ended, Refunded — or, if they choose, left
 * canceled, the rest of it left to the user.
 */
export async function refundPayment(
  input: z.infer<typeof refundPaymentSchema>,
  adminId: string
) {
  const row = await db.query.payments.findFirst({
    where: eq(payments.id, input.paymentId)
  });
  if (!row) throw new PublicError('Payment not found.');
  const { refundFee } = await getRefundPolicy();
  const payment = await withFee(row, refundFee);
  const sub = payment.subscriptionId
    ? await db.query.subscriptions.findFirst({
        where: eq(subscriptions.id, payment.subscriptionId),
        columns: { id: true, reason: true }
      })
    : null;
  const duplicate = isDuplicate(sub?.reason);
  await startRefund(
    payment.id,
    refundableMinor(payment, refundFee, duplicate),
    {
      adminId,
      endSubscription: sub && !duplicate ? input.endSubscription : null
    },
    { refundFee }
  );
  if (sub && !duplicate) await holdForRefund(sub.id, adminId);
}

// ============================================================================
// What other services ask
// ============================================================================

/** Whether a user has a subscription in effect. */
export async function hasLiveSubscription(userId: string) {
  return !!(await liveSubscription(userId));
}

/** Of these users, each one's subscription in effect: its status, and
 *  when it renews or ends. */
export async function liveSubscriptionsOf(
  userIds: string[]
): Promise<Map<string, Pick<SubscriptionRow, 'status' | 'periodEnd'>>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({
      userId: subscriptions.userId,
      status: subscriptions.status,
      periodEnd: subscriptions.periodEnd
    })
    .from(subscriptions)
    .where(
      and(
        inArray(subscriptions.userId, userIds),
        inArray(subscriptions.status, LIVE_STATUSES)
      )
    );
  return new Map(rows.map(({ userId, ...sub }) => [userId, sub]));
}

/**
 * Whether anyone has ever subscribed to a plan. From then on its billing,
 * prices, processor and price IDs are what the processor charges against,
 * and subscriptions and payments point at it, so those stay as they are and
 * the plan is not deleted.
 */
export async function planHasSubscriptions(planId: string) {
  const row = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.planId, planId),
    columns: { id: true }
  });
  return !!row;
}

/** Of these plans, the ones anyone has subscribed to. */
export async function plansWithSubscriptions(
  planIds: string[]
): Promise<Set<string>> {
  if (planIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ planId: subscriptions.planId })
    .from(subscriptions)
    .where(inArray(subscriptions.planId, planIds));
  return new Set(rows.map(r => r.planId));
}

// ============================================================================
// Console
// ============================================================================

/** What each subscription has paid. */
async function paidOf(subscriptionIds: string[]) {
  const paid = new Map<string, number>();
  if (subscriptionIds.length === 0) return paid;
  const rows = await db
    .select({
      id: payments.subscriptionId,
      paid: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.status} <> 'failed'), 0)`
    })
    .from(payments)
    .where(inArray(payments.subscriptionId, subscriptionIds))
    .groupBy(payments.subscriptionId);
  for (const r of rows) if (r.id) paid.set(r.id, Number(r.paid));
  return paid;
}

/**
 * One page of subscriptions, newest first — by status, processor, or the
 * user's name or email — with the price each is on and what it has
 * paid.
 */
export async function listSubscriptions(
  filter: z.infer<typeof subscriptionListSchema>
) {
  const conditions: Array<SQL | undefined> = [
    filter.status ? eq(subscriptions.status, filter.status) : undefined,
    filter.processor ? eq(subscriptions.processor, filter.processor) : undefined
  ];
  const term = filter.q?.trim();
  if (term) {
    conditions.push(
      inArray(
        subscriptions.userId,
        db
          .select({ id: users.id })
          .from(users)
          .where(
            or(ilike(users.name, `%${term}%`), ilike(users.email, `%${term}%`))
          )
      )
    );
  }
  const where = and(...conditions.filter(Boolean));

  const [rows, [totalRow]] = await Promise.all([
    db.query.subscriptions.findMany({
      where,
      ...pageWindow(filter),
      orderBy: s => [desc(s.createdAt), desc(s.id)],
      with: {
        user: { columns: { id: true, name: true, email: true } },
        plan: true
      }
    }),
    db.select({ count: count() }).from(subscriptions).where(where)
  ]);
  const [paid, unpaid] = await Promise.all([
    paidOf(rows.map(r => r.id)),
    unpaidRenewalsOf(rows.filter(r => r.status !== 'ended'))
  ]);
  return {
    rows: rows.map(({ plan, ...sub }) => ({
      id: sub.id,
      user: sub.user,
      planName: plan.name,
      interval: plan.interval,
      price: priceOf(plan),
      status: sub.status,
      periodEnd: sub.periodEnd,
      endedAt: sub.endedAt,
      reason: sub.reason,
      processor: sub.processor,
      externalId: sub.externalId,
      createdAt: sub.createdAt,
      paid: paid.get(sub.id) ?? 0,
      // A renewal unpaid: cancelling it ends it.
      paymentFailed: unpaid.has(sub.id)
    })),
    total: Number(totalRow?.count ?? 0),
    page: filter.page,
    pageSize: filter.pageSize
  };
}

/**
 * Everything the console shows of one subscription: where it stands and
 * what it charges next, its payments, and its refund requests.
 */
export async function getSubscriptionDetail(id: string) {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, id),
    with: {
      user: { columns: { id: true, name: true, email: true } },
      plan: true,
      refundRequests: {
        orderBy: r => [desc(r.createdAt)],
        with: {
          payments: {
            columns: { id: true, refundAmount: true, status: true }
          }
        }
      }
    }
  });
  if (!sub) throw new PublicError('Subscription not found.');
  const processor = await getPaymentProcessor(sub.processor);
  const [dashboardUrl, paid] = await Promise.all([
    processor.dashboardUrl(sub.externalId).catch(() => null),
    listSubscriptionPayments(sub.id)
  ]);
  const price = priceOf(sub.plan);

  return {
    id: sub.id,
    user: sub.user,
    planName: sub.plan.name,
    interval: sub.plan.interval,
    price,
    status: sub.status,
    periodEnd: sub.periodEnd,
    canceledAt: sub.canceledAt,
    endedAt: sub.endedAt,
    reason: sub.reason,
    nextCharge:
      sub.status === 'active' ? { at: sub.periodEnd, amount: price } : null,
    processor: sub.processor,
    externalId: sub.externalId,
    customerId: sub.customerId,
    dashboardUrl,
    createdAt: sub.createdAt,
    refundRequests: sub.refundRequests,
    payments: paid
  };
}
