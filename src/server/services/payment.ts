import '@tanstack/react-start/server-only';

import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  type SQL
} from 'drizzle-orm';
import { type z } from 'zod';

import { pageWindow } from '@/types/pagination';
import {
  isDuplicate,
  PAYMENT_PROCESSORS,
  REFUNDABLE_STATUSES,
  refundLeftCents,
  toCents,
  toDollars,
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
  type ProcessorPayment
} from '@/server/services/payment-processor';
import { getRefundPolicy } from '@/server/services/settings';

/**
 * The payments the processors took, one row per invoice, written from their
 * webhooks as they report them. What has been refunded of a payment is kept
 * on it: `refund_amount` is what a refund sent from here sent, from the
 * moment it is sent — `refund_pending` until the processor confirms it — and
 * then what the processor says went back. A payment is a record of what was
 * paid, kept when its user is deleted.
 */

type PaymentRow = typeof payments.$inferSelect;

/** One lock per payment, whoever writes it: the webhooks and the refunds. */
const lockKey = (processor: PaymentProcessorId, externalId: string) =>
  `payment:${processor}:${externalId}`;

/** A payment's status by whether any of it has gone back: a payment is
 *  refunded once, of what the refund settings let go back, so any of it
 *  is refunded. */
export function refundedStatus(refundedCents: number): PaymentStatus {
  return refundedCents > 0 ? 'refunded' : 'paid';
}

/**
 * What is left of a payment to refund, in cents: what the refund fee lets
 * go back of it — all of it less the processor's fee on `auto`, or less the
 * percentage set — less what has gone back already. Nothing for a payment
 * that cannot be refunded, or has a refund waiting.
 */
export function leftToRefundCents(
  payment: Pick<
    PaymentRow,
    'amount' | 'refundAmount' | 'fee' | 'tax' | 'status'
  >,
  refundFee: number | null
): number {
  if (!REFUNDABLE_STATUSES.includes(payment.status)) return 0;
  return refundLeftCents(payment, refundFee);
}

/**
 * Keep one invoice as the processor reports it now, for the subscription it
 * belongs to. Paid or failed as the invoice says — unless a refund or a
 * dispute has happened to it since, which the invoice does not say.
 */
export async function recordPayment(
  processor: PaymentProcessorId,
  payment: ProcessorPayment,
  sub: { id: string; userId: string; planId: string }
): Promise<PaymentRow> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, sub.userId),
    columns: { email: true }
  });
  return await withLock(lockKey(processor, payment.externalId), async tx => {
    const existing = await tx.query.payments.findFirst({
      where: and(
        eq(payments.processor, processor),
        eq(payments.externalId, payment.externalId)
      )
    });
    const invoiceStatus: PaymentStatus = payment.paid ? 'paid' : 'failed';
    const status =
      existing && existing.status !== 'paid' && existing.status !== 'failed'
        ? existing.status
        : invoiceStatus;
    const values = {
      transactionId: payment.transactionId,
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
        .set(values)
        .where(eq(payments.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await tx
      .insert(payments)
      .values({
        id: generateUUID(),
        userId: sub.userId,
        userEmail: user?.email ?? '',
        subscriptionId: sub.id,
        planId: sub.planId,
        processor,
        externalId: payment.externalId,
        ...values
      })
      .returning();
    return row;
  });
}

/**
 * The payment a refund or a dispute names, which must be kept already. A
 * processor may report one before the payment itself: thrown, so the
 * webhook fails and is sent again, by when the payment is kept.
 */
async function requirePayment(
  processor: PaymentProcessorId,
  transactionId: string
) {
  const found = await paymentByTransaction(processor, transactionId);
  if (!found) {
    throw new Error(
      `[payment] ${processor} ${transactionId} is not kept yet, so what is reported of it waits`
    );
  }
  return found;
}

/** A payment by the transaction that took its money, as refunds and
 *  disputes name it. */
async function paymentByTransaction(
  processor: PaymentProcessorId,
  transactionId: string
) {
  return await db.query.payments.findFirst({
    where: and(
      eq(payments.processor, processor),
      eq(payments.transactionId, transactionId)
    )
  });
}

/** A dispute of a payment. Returns the payment. */
export async function markDisputed(
  processor: PaymentProcessorId,
  transactionId: string
) {
  const row = await requirePayment(processor, transactionId);
  await db
    .update(payments)
    .set({ status: 'disputed', updatedAt: new Date() })
    .where(eq(payments.id, row.id));
  return row;
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
 * What is left to refund of a payment, in cents: under the refund fee, or,
 * for a duplicate's, all of it.
 */
export function refundableCents(
  payment: Parameters<typeof leftToRefundCents>[0],
  refundFee: number | null,
  duplicate: boolean
): number {
  return leftToRefundCents(payment, duplicate ? 0 : refundFee);
}

/**
 * Refund `cents` of a payment through its processor, for an admin — and for
 * a refund request they approved, which it then names. The payment is
 * `refund_pending` from before the processor is asked, so a webhook that
 * answers first finds it so, until the processor confirms the refund. A
 * processor that refuses at once leaves the payment as it was.
 */
export async function startRefund(
  paymentId: string,
  cents: number,
  by: {
    /** The admin who sent it; none for the app's own, a duplicate's. */
    adminId: string | null;
    requestId?: string | null;
    /** Try the processor again when it fails for a while. */
    retry?: boolean;
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

  const before = await withLock(
    lockKey(found.processor, found.externalId),
    async tx => {
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
      const whole = await ofDuplicate(row.subscriptionId, tx);
      const left = whole
        ? leftToRefundCents(row, 0)
        : leftToRefundCents(row, refundFee);
      if (left === 0) {
        throw new PublicError('Nothing is left to refund of this payment.');
      }
      if (cents <= 0 || cents > left) {
        throw new PublicError(
          `At most ${formatPrice(toDollars(left))} is left to refund of this payment.`
        );
      }
      await tx
        .update(payments)
        .set({
          status: 'refund_pending',
          // What is sent, kept from now: the processor confirms it later.
          refundAmount: toDollars(toCents(row.refundAmount) + cents).toFixed(2),
          refundBy: by.adminId,
          refundRequestId: by.requestId ?? null,
          refundFee: whole
            ? '0'
            : refundFee == null
              ? 'auto'
              : String(refundFee),
          refundAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(payments.id, row.id));
      return row;
    }
  );

  try {
    const processor = await getPaymentProcessor(before.processor);
    const request = () =>
      processor.refundPayment(before, {
        cents,
        whole:
          cents === toCents(before.amount) && toCents(before.refundAmount) === 0
      });
    await (by.retry ? withRetry(request) : request());
  } catch (err) {
    await db
      .update(payments)
      .set({
        status: before.status,
        refundAmount: before.refundAmount,
        refundBy: before.refundBy,
        refundRequestId: before.refundRequestId,
        refundFee: before.refundFee,
        refundAt: before.refundAt,
        updatedAt: new Date()
      })
      .where(
        and(eq(payments.id, before.id), eq(payments.status, 'refund_pending'))
      );
    throw err;
  }
}

/**
 * The processor says how much of a payment has gone back in all. A payment
 * that was `refund_pending` had its refund sent from here, and keeps who
 * sent it; any other refund was made in the processor itself, and clears
 * that. Nothing new — a webhook sent again — changes nothing.
 */
export async function applyRefund(
  processor: PaymentProcessorId,
  transactionId: string,
  refundAmount: number
): Promise<{ subscriptionId: string | null } | null> {
  const found = await requirePayment(processor, transactionId);
  await withLock(lockKey(processor, found.externalId), async tx => {
    const row = await tx.query.payments.findFirst({
      where: eq(payments.id, found.id)
    });
    if (!row) return;
    const cents = Math.round(refundAmount * 100);
    // A refund sent from here, confirmed: what the processor says went
    // back, whatever was sent. Otherwise only more than is known is news —
    // a refund made in the processor itself.
    const ours = row.status === 'refund_pending';
    if (!ours && cents <= toCents(row.refundAmount)) return;
    await tx
      .update(payments)
      .set({
        refundAmount: toDollars(cents).toFixed(2),
        status: row.status === 'disputed' ? 'disputed' : refundedStatus(cents),
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
  });
  return { subscriptionId: found.subscriptionId };
}

/** The processor refused a refund sent from here, or failed one it had
 *  reported: the payment is as it was before it, and still names who sent
 *  it. */
export async function failRefund(
  processor: PaymentProcessorId,
  transactionId: string
): Promise<{ subscriptionId: string | null } | null> {
  const found = await paymentByTransaction(processor, transactionId);
  if (!found) return null;
  const failed = await withLock(
    lockKey(processor, found.externalId),
    async tx => {
      const row = await tx.query.payments.findFirst({
        where: eq(payments.id, found.id)
      });
      // Waiting for it — or, on Stripe, already told it went back: Stripe
      // reports a refund refunded as soon as it is made, and only later that
      // it failed. A refund made in the processor itself is not ours to undo.
      const ours =
        row?.status === 'refund_pending' ||
        (row?.status === 'refunded' && row.refundFee != null);
      if (!row || !ours) return false;
      // Only a paid payment is refunded from here, so it was paid, with
      // nothing refunded, before.
      await tx
        .update(payments)
        .set({ status: 'paid', refundAmount: '0.00', updatedAt: new Date() })
        .where(eq(payments.id, row.id));
      return true;
    }
  );
  return failed ? { subscriptionId: found.subscriptionId } : null;
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
      leftToRefund: toDollars(
        refundableCents(
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
    leftToRefund: toDollars(refundableCents(row, refundFee, duplicate))
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
