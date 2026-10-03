import '@tanstack/react-start/server-only';

import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  type SQL
} from 'drizzle-orm';
import { type z } from 'zod';

import { pageWindow } from '@/types/pagination';
import {
  isDuplicate,
  PAYMENT_PROCESSORS,
  REFUNDABLE_STATUSES,
  refundLeftMinor,
  toAmount,
  toMinor,
  type paymentListSchema,
  type PaymentProcessorId,
  type PaymentStatus
} from '@/types/payment';
import { formatPrice } from '@/lib/format-amount';
import { generateUUID } from '@/lib/utils';
import { db } from '@/db';
import { payments, subscriptions, users } from '@/db/schema';
import { PublicError } from '@/server/public-error';
import { withLock } from '@/server/services/db-lock';
import {
  getPaymentProcessor,
  withRetry,
  type ProcessorPayment,
  type ProcessorRefund
} from '@/server/services/payment-processor';
import { getRefundPolicy } from '@/server/services/settings';

/**
 * The payments the processors took, one row per invoice, written from their
 * webhooks as they report them. A payment's `status` is reckoned from the
 * facts kept on it — paid, how much has gone back, a refund waiting, a
 * dispute — each written by the webhook that says it. A payment is a record
 * of what was paid, kept when its user is deleted.
 */

type PaymentRow = typeof payments.$inferSelect;

/** One lock per payment, whoever writes it: the webhooks and the refunds. */
const lockKey = (processor: PaymentProcessorId, externalId: string) =>
  `payment:${processor}:${externalId}`;

/**
 * What is left of a payment to refund, in whole units: what the refund fee lets
 * go back of it — all of it less the processor's fee on `auto`, or less the
 * percentage set — less what has gone back already. Nothing for a payment
 * that cannot be refunded, or has a refund waiting.
 */
export function leftToRefundMinor(
  payment: Pick<
    PaymentRow,
    'amount' | 'refundAmount' | 'fee' | 'tax' | 'status'
  >,
  refundFee: number | null
): number {
  if (!REFUNDABLE_STATUSES.includes(payment.status)) return 0;
  return refundLeftMinor(payment, refundFee);
}

/**
 * Keep one invoice as a webhook reports it, for its user and plan, and for
 * its subscription when that is kept — attached later otherwise. Paid or
 * failed, as the invoice says.
 */
export async function recordPayment(
  processor: PaymentProcessorId,
  payment: ProcessorPayment,
  owner: { userId: string; planId: string; subscriptionId: string | null }
): Promise<PaymentRow> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, owner.userId),
    columns: { email: true }
  });
  return await withLock(lockKey(processor, payment.externalId), async tx => {
    const existing = await tx.query.payments.findFirst({
      where: and(
        eq(payments.processor, processor),
        eq(payments.externalId, payment.externalId)
      )
    });
    const status: PaymentStatus = payment.paid ? 'paid' : 'failed';
    const values = {
      transactionId: payment.transactionId,
      externalSubscriptionId: payment.externalSubscriptionId,
      periodEnd: payment.periodEnd,
      amount: payment.amount.toFixed(2),
      kind: payment.kind,
      fee: payment.fee?.toFixed(2) ?? existing?.fee ?? null,
      tax: payment.tax?.toFixed(2) ?? existing?.tax ?? null,
      status,
      invoiceUrl: payment.invoiceUrl,
      billedAt: payment.billedAt,
      updatedAt: new Date()
    };
    if (existing) {
      const [row] = await tx
        .update(payments)
        .set({
          ...values,
          subscriptionId: existing.subscriptionId ?? owner.subscriptionId
        })
        .where(eq(payments.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await tx
      .insert(payments)
      .values({
        id: generateUUID(),
        userId: owner.userId,
        userEmail: user?.email ?? '',
        subscriptionId: owner.subscriptionId,
        planId: owner.planId,
        processor,
        externalId: payment.externalId,
        ...values
      })
      .returning();
    return row;
  });
}

/**
 * Payments reported before their subscription was kept, attached to it now
 * that it is. Returns them.
 */
export async function attachPayments(
  processor: PaymentProcessorId,
  userId: string,
  externalSubscriptionId: string,
  subscriptionId: string,
  ex: Pick<typeof db, 'update'> = db
) {
  return await ex
    .update(payments)
    .set({ subscriptionId, updatedAt: new Date() })
    .where(
      and(
        eq(payments.userId, userId),
        eq(payments.processor, processor),
        eq(payments.externalSubscriptionId, externalSubscriptionId),
        isNull(payments.subscriptionId)
      )
    )
    .returning();
}

/**
 * The payment a refund or a dispute is about, by the transaction that took
 * its money — the id the refund was sent with, and the one the processor
 * names. Where the webhook also names the user and plan, they must be the
 * payment's. Not kept is an error: the webhook fails.
 */
async function paymentByTransaction(
  processor: PaymentProcessorId,
  transactionId: string,
  named?: { userId: string | null; planId: string | null }
) {
  const found = await db.query.payments.findFirst({
    where: and(
      eq(payments.processor, processor),
      eq(payments.transactionId, transactionId)
    )
  });
  if (!found) {
    throw new Error(`[payment] ${processor} ${transactionId} is not kept`);
  }
  if (
    (named?.userId && named.userId !== found.userId) ||
    (named?.planId && named.planId !== found.planId)
  ) {
    throw new Error(
      `[payment] ${processor} ${transactionId} is not ${named.userId}'s on ${named.planId}`
    );
  }
  return found;
}

/** A dispute of a payment. Returns the payment, or null when none is kept. */
export async function markDisputed(
  processor: PaymentProcessorId,
  transactionId: string
) {
  const found = await paymentByTransaction(processor, transactionId);
  await withLock(lockKey(processor, found.externalId), async tx => {
    await tx
      .update(payments)
      .set({ status: 'disputed', updatedAt: new Date() })
      .where(eq(payments.id, found.id));
  });
  return found;
}

/**
 * A dispute closed in the seller's favour: the payment is as it was before
 * it — paid, or refunded by what has gone back. Returns the payment, or
 * null when it is not kept or was not disputed.
 */
export async function markUndisputed(
  processor: PaymentProcessorId,
  transactionId: string
) {
  const found = await paymentByTransaction(processor, transactionId);
  return await withLock(lockKey(processor, found.externalId), async tx => {
    const row = await tx.query.payments.findFirst({
      where: eq(payments.id, found.id)
    });
    if (row?.status !== 'disputed') return null;
    await tx
      .update(payments)
      .set({ status: 'paid', updatedAt: new Date() })
      .where(eq(payments.id, row.id));
    return row;
  });
}

// ============================================================================
// Refunds
// ============================================================================

/** Whether a subscription is a duplicate, whose payments go back whole. */
async function ofDuplicate(
  subscriptionId: string | null,
  executor: Pick<typeof db, 'query'> = db
): Promise<boolean> {
  if (!subscriptionId) return false;
  const sub = await executor.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId),
    columns: { cancelReason: true }
  });
  return isDuplicate(sub?.cancelReason);
}

/**
 * What is left to refund of a payment, in whole units: under the refund fee, or,
 * for a duplicate's, all of it.
 */
export function refundableMinor(
  payment: Parameters<typeof leftToRefundMinor>[0],
  refundFee: number | null,
  duplicate: boolean
): number {
  return leftToRefundMinor(payment, duplicate ? 0 : refundFee);
}

/**
 * Refund `minor` of a payment through its processor, for an admin — and for
 * a refund request they approved, which it then names. Done under the
 * payment's lock, as one step: the payment is `refund_pending`, naming the
 * refund the processor made, by the time its webhooks are let at it. A
 * processor that refuses leaves the payment as it was.
 */
export async function startRefund(
  paymentId: string,
  minor: number,
  by: {
    /** The admin who sent it; none for the app's own, a duplicate's. */
    adminId: string | null;
    requestId?: string | null;
    /** Try the processor again when it fails for a while. */
    retry?: boolean;
    /** What the refund owes the subscription once it is confirmed: canceled
     *  at once, or when it expires. None for a refund that cancels nothing. */
    cancelSubscription?: boolean | null;
    /** All of it, whatever the refund fee: it bought nothing. */
    full?: boolean;
  },
  /** The refund fee, read by the caller already — with the processor's fee
   *  kept on the payment by then — not to be read again. */
  known?: { refundFee: number | null }
) {
  const found = await db.query.payments.findFirst({
    where: eq(payments.id, paymentId)
  });
  if (!found) throw new PublicError('Payment not found.');
  const { refundFee } = known ?? (await getRefundPolicy());
  // The processor's fee, known before the lock: a refund on `auto` keeps it.
  if (!known) await withFee(found, refundFee);

  await withLock(lockKey(found.processor, found.externalId), async tx => {
    const row = await tx.query.payments.findFirst({
      where: eq(payments.id, paymentId)
    });
    if (!row) throw new PublicError('Payment not found.');
    if (row.status === 'refund_pending') {
      throw new PublicError(
        'A refund of this payment is still being processed.'
      );
    }
    if (!REFUNDABLE_STATUSES.includes(row.status)) {
      throw new PublicError('This payment cannot be refunded.');
    }
    // A duplicate's payment goes back whole: it bought nothing.
    const whole = by.full || (await ofDuplicate(row.subscriptionId, tx));
    const left = whole
      ? leftToRefundMinor(row, 0)
      : leftToRefundMinor(row, refundFee);
    if (left === 0) {
      throw new PublicError('Nothing is left to refund of this payment.');
    }
    if (minor <= 0 || minor > left) {
      throw new PublicError(
        `At most ${formatPrice(toAmount(left))} is left to refund of this payment.`
      );
    }
    const processor = await getPaymentProcessor(row.processor);
    const request = () =>
      processor.refundPayment(row, {
        minor,
        whole: minor === toMinor(row.amount) && toMinor(row.refundAmount) === 0
      });
    const made = await (by.retry ? withRetry(request) : request());
    await tx
      .update(payments)
      .set({
        status: 'refund_pending',
        // What is sent, kept from now: the processor confirms it later.
        refundAmount: toAmount(toMinor(row.refundAmount) + minor).toFixed(2),
        externalRefundId: made.externalId,
        refundBy: by.adminId,
        refundRequestId: by.requestId ?? null,
        refundCancelSubscription: by.cancelSubscription ?? null,
        refundFee: whole ? '0' : refundFee == null ? 'auto' : String(refundFee),
        refundAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(payments.id, row.id));
  });
}

/**
 * The processor reports a refund of a payment, by the refund's id. The id
 * `refundPayment` returned is kept on the payment, so the refund sent from
 * here is known by it; any other id is a refund made in the processor
 * itself, which then names who made it no more. The same refund reported
 * again — pending, then approved — adds nothing twice.
 *
 * - Pending: a refund made in the processor and not yet approved is kept as
 *   waiting; ours already is.
 * - Succeeded: what has gone back is what the processor says went back in
 *   all, where it says — else this refund more, once.
 * - Failed: the refund is undone, and the payment is as before it.
 *
 * Money that went back ends what it paid for, wherever the refund was made:
 * `cancelSubscription` is what the subscription is still owed for it —
 * canceled at once, or when it expires — and null when nothing is. A refund
 * sent from here owes what the admin chose; one made in the processor, at
 * once when all of it went back, else when it expires. It is owed until
 * `clearRefundCancel` says it is done, so a webhook sent again does it.
 */
export async function applyRefund(
  processor: PaymentProcessorId,
  transactionId: string,
  refund: ProcessorRefund,
  named?: { userId: string | null; planId: string | null }
): Promise<{
  paymentId: string;
  subscriptionId: string | null;
  refundRequestId: string | null;
  cancelSubscription: boolean | null;
  failed: boolean;
} | null> {
  const found = await paymentByTransaction(processor, transactionId, named);
  const outcome = await withLock(
    lockKey(processor, found.externalId),
    async tx => {
      const row = await tx.query.payments.findFirst({
        where: eq(payments.id, found.id)
      });
      if (!row) return null;
      // The refund kept on the payment: sent from here (`refundFee` says by
      // which rule), or made in the processor and kept when first reported.
      const known = refund.externalId === row.externalRefundId;
      const ours = known && row.refundFee != null;

      if (refund.status === 'failed') {
        // A refund not kept failed: nothing of it was ever written.
        if (!known) return null;
        // Only a paid payment is refunded, so it was paid, with nothing
        // refunded, before.
        await tx
          .update(payments)
          .set({
            status: 'paid',
            refundAmount: '0.00',
            refundCancelSubscription: null,
            updatedAt: new Date()
          })
          .where(eq(payments.id, row.id));
        return { failed: true, owed: null, requestId: row.refundRequestId };
      }

      const amountMinor = toMinor(row.amount);
      let minor = toMinor(row.refundAmount);
      if (refund.total != null) {
        minor = toMinor(refund.total);
      } else if (!known) {
        minor += toMinor(refund.amount);
      }
      const pending = refund.status === 'pending';
      // Nothing back yet, or nothing new: nothing owed by this.
      const disputed = row.status === 'disputed';
      const owed =
        pending || minor === 0 || disputed
          ? null
          : ours
            ? row.refundCancelSubscription
            : minor >= amountMinor;
      await tx
        .update(payments)
        .set({
          refundAmount: toAmount(minor).toFixed(2),
          status: disputed
            ? 'disputed'
            : pending
              ? 'refund_pending'
              : 'refunded',
          externalRefundId: refund.externalId,
          refundCancelSubscription: pending
            ? row.refundCancelSubscription
            : owed,
          ...(ours
            ? {}
            : {
                refundBy: null,
                refundRequestId: null,
                refundFee: null,
                refundAt: new Date()
              }),
          updatedAt: new Date()
        })
        .where(eq(payments.id, row.id));
      return { failed: false, owed, requestId: row.refundRequestId };
    }
  );
  if (!outcome) return null;
  return {
    paymentId: found.id,
    subscriptionId: found.subscriptionId,
    refundRequestId: outcome.requestId,
    cancelSubscription: outcome.owed,
    failed: outcome.failed
  };
}

/** What a refund owed its subscription has been done. */
export async function clearRefundCancel(paymentId: string) {
  await db
    .update(payments)
    .set({ refundCancelSubscription: null })
    .where(eq(payments.id, paymentId));
}

/**
 * A payment with the fee its processor kept, for a refund that gives back
 * all but the fee. The fee may not be known when the payment is first
 * recorded; the processor is asked once more, and the answer kept.
 */
export async function withFee(
  payment: PaymentRow,
  refundFee: number | null
): Promise<PaymentRow> {
  // Only `auto` goes by the processor's fee.
  if (refundFee != null || payment.fee != null) return payment;
  const reportsFee = PAYMENT_PROCESSORS.some(
    p => p.id === payment.processor && p.reportsFee
  );
  if (!reportsFee) return payment;
  const processor = await getPaymentProcessor(payment.processor);
  const reported = await processor.getPayment(payment.externalId).catch(err => {
    console.warn(`[payment] no fee for ${payment.id}`, err);
    return null;
  });
  if (reported?.fee == null) return payment;
  const fee = reported.fee.toFixed(2);
  const tax = reported.tax?.toFixed(2) ?? payment.tax;
  await db
    .update(payments)
    .set({ fee, tax, updatedAt: new Date() })
    .where(eq(payments.id, payment.id));
  return { ...payment, fee, tax };
}

// ============================================================================
// Lists
// ============================================================================

/** Processors that make an invoice when asked, rather than keep a link. */
export async function invoiceOnDemand(rows: PaymentRow[]) {
  const onDemand = new Map<PaymentProcessorId, boolean>();
  for (const id of new Set(rows.map(r => r.processor))) {
    const processor = await getPaymentProcessor(id);
    onDemand.set(id, !!processor.invoiceUrl);
  }
  return (row: PaymentRow) =>
    !row.invoiceUrl && row.status !== 'failed' && !!onDemand.get(row.processor);
}

/** Who refunded a payment last, as a list shows it. */
const REFUND_WITH = {
  refundByUser: { columns: { id: true, name: true, email: true } },
  refundRequest: { columns: { id: true, status: true } }
} as const;

/** A user's own payments, newest first. */
export async function listMyPayments(userId: string) {
  const rows = await db.query.payments.findMany({
    where: eq(payments.userId, userId),
    orderBy: p => [desc(p.billedAt)],
    limit: 50,
    with: {
      plan: { columns: { name: true } },
      refundRequest: { columns: { id: true, status: true } }
    }
  });
  const onDemand = await invoiceOnDemand(rows);
  return rows.map(row => ({
    id: row.id,
    amount: row.amount,
    refundAmount: row.refundAmount,
    kind: row.kind,
    status: row.status,
    invoiceUrl: row.invoiceUrl,
    invoiceOnDemand: onDemand(row),
    billedAt: row.billedAt,
    plan: row.plan,
    refundRequest: row.refundRequest
  }));
}

/** One page of every payment, newest first, for the console. */
export async function listPayments(page: z.infer<typeof paymentListSchema>) {
  const conditions: Array<SQL | undefined> = [
    page.status ? eq(payments.status, page.status) : undefined,
    page.processor ? eq(payments.processor, page.processor) : undefined
  ];
  const term = page.q?.trim();
  if (term) {
    conditions.push(
      or(
        ilike(payments.userEmail, `%${term}%`),
        inArray(
          payments.userId,
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
      )
    );
  }
  const where = and(...conditions.filter(Boolean));
  const [rows, [totalRow]] = await Promise.all([
    db.query.payments.findMany({
      where,
      ...pageWindow(page),
      orderBy: p => [desc(p.billedAt), desc(p.id)],
      with: {
        user: { columns: { id: true, name: true, email: true } },
        plan: { columns: { name: true } },
        subscription: { columns: { status: true, cancelReason: true } },
        ...REFUND_WITH
      }
    }),
    db.select({ count: count() }).from(payments).where(where)
  ]);
  const [onDemand, { refundFee }] = await Promise.all([
    invoiceOnDemand(rows),
    getRefundPolicy()
  ]);
  return {
    rows: rows.map(row => ({
      ...row,
      invoiceOnDemand: onDemand(row),
      leftToRefund: toAmount(
        refundableMinor(
          row,
          refundFee,
          isDuplicate(row.subscription?.cancelReason)
        )
      )
    })),
    total: Number(totalRow?.count ?? 0),
    page: page.page,
    pageSize: page.pageSize
  };
}

/** A subscription's payments, newest first, for the console. */
export async function listSubscriptionPayments(subscriptionId: string) {
  const rows = await db.query.payments.findMany({
    where: eq(payments.subscriptionId, subscriptionId),
    orderBy: p => [desc(p.billedAt)],
    with: { plan: { columns: { name: true } }, ...REFUND_WITH }
  });
  const [onDemand, { refundFee }, duplicate] = await Promise.all([
    invoiceOnDemand(rows),
    getRefundPolicy(),
    ofDuplicate(subscriptionId)
  ]);
  return rows.map(row => ({
    ...row,
    invoiceOnDemand: onDemand(row),
    leftToRefund: toAmount(refundableMinor(row, refundFee, duplicate))
  }));
}

/**
 * A payment's invoice: the link kept on it, or one the processor makes now.
 * `userId` limits it to that user's own payments.
 */
export async function openInvoice(
  paymentId: string,
  userId?: string
): Promise<{ url: string }> {
  const row = await db.query.payments.findFirst({
    where: userId
      ? and(eq(payments.id, paymentId), eq(payments.userId, userId))
      : eq(payments.id, paymentId),
    columns: { processor: true, externalId: true, invoiceUrl: true }
  });
  if (!row) throw new PublicError('Payment not found.');
  if (row.invoiceUrl) return { url: row.invoiceUrl };
  const processor = await getPaymentProcessor(row.processor);
  const url = await processor.invoiceUrl?.(row.externalId);
  if (!url) throw new PublicError('This payment has no invoice.');
  return { url };
}
