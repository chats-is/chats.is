import '@tanstack/react-start/server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  toAmount,
  type PaymentKind,
  type ProcessorPrice
} from '@/types/payment';
import { type env as Env } from '@/lib/env';
import { PublicError } from '@/server/public-error';
import {
  WebhookSignatureError,
  type PaymentMethod,
  type PaymentProcessor,
  type ProcessorPayment,
  type ProcessorRefund,
  type ProcessorSubscription,
  type WebhookAction
} from '@/server/services/payment-processor';

/**
 * Paddle Billing, as a payment processor.
 *
 * A plan's price is a Paddle price (`pri_…`). Checkout is a transaction for
 * it, opened by Paddle.js on the app's own page (`/pay/paddle`), which Paddle
 * sends the user to with the transaction in `?_ptxn=`. The subscription it
 * makes carries the user and plan in its custom data.
 */

type PaddleKeys = {
  apiKey: string;
  webhookSecret: string | undefined;
  clientToken: string | undefined;
  sandbox: boolean;
};

let envModule: Promise<{ env: typeof Env }> | undefined;

/** `env`, imported here rather than at the top: importing it validates the
 *  whole environment, and tests reach this module with none. Once, and
 *  shared by calls made together. */
const loadEnv = () => (envModule ??= import('@/lib/env'));

async function paddleKeys(): Promise<PaddleKeys> {
  const { env } = await loadEnv();
  if (!env.PADDLE_API_KEY) throw new PublicError('Paddle is not configured.');
  return {
    apiKey: env.PADDLE_API_KEY,
    webhookSecret: env.PADDLE_WEBHOOK_SECRET,
    clientToken: env.PADDLE_CLIENT_TOKEN,
    // The keys say which Paddle they belong to: a sandbox API key is
    // `pdl_sdbx_…`, a sandbox client token `test_…`.
    sandbox:
      env.PADDLE_API_KEY.startsWith('pdl_sdbx_') ||
      !!env.PADDLE_CLIENT_TOKEN?.startsWith('test_')
  };
}

/** What Paddle.js needs on the checkout page, or null when unset. */
export async function paddleCheckoutConfig(): Promise<{
  clientToken: string;
  sandbox: boolean;
} | null> {
  const { env } = await loadEnv();
  if (!env.PADDLE_CLIENT_TOKEN) return null;
  return {
    clientToken: env.PADDLE_CLIENT_TOKEN,
    sandbox:
      env.PADDLE_CLIENT_TOKEN.startsWith('test_') ||
      !!env.PADDLE_API_KEY?.startsWith('pdl_sdbx_')
  };
}

class PaddleError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string
  ) {
    super(message);
  }
}

async function paddle<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown
): Promise<T> {
  const keys = await paddleKeys();
  const base = keys.sandbox
    ? 'https://sandbox-api.paddle.com'
    : 'https://api.paddle.com';
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${keys.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: { code?: string; detail?: string };
  };
  if (!res.ok) {
    throw new PaddleError(
      res.status,
      json.error?.code,
      `Paddle ${method} ${path} failed (${res.status}): ${json.error?.detail ?? json.error?.code ?? 'no detail'}`
    );
  }
  return json.data as T;
}

/**
 * The Paddle customer with a user's email, made when Paddle has none. Paddle
 * keeps one customer to an email, so every checkout of a user is one
 * customer, paying under the email they signed up with.
 */
async function customerFor(email: string): Promise<string> {
  const find = async () =>
    (
      await paddle<{ id: string }[]>(
        'GET',
        `/customers?email=${encodeURIComponent(email)}`
      )
    )[0]?.id;
  const found = await find();
  if (found) return found;
  try {
    return (await paddle<{ id: string }>('POST', '/customers', { email })).id;
  } catch (err) {
    // Made meanwhile, by another checkout: that one it is.
    const made = await find();
    if (made) return made;
    throw err;
  }
}

type PaddlePrice = {
  id: string;
  status: 'active' | 'archived';
  billing_cycle: { interval: string; frequency: number } | null;
  unit_price: { amount: string; currency_code: string };
  quantity: { minimum: number; maximum: number } | null;
};

type PaddleSubscription = {
  id: string;
  status: 'active' | 'canceled' | 'past_due' | 'paused' | 'trialing';
  customer_id: string;
  custom_data: Record<string, unknown> | null;
  items: Array<{ price: { id: string } }>;
  current_billing_period: { starts_at: string; ends_at: string } | null;
  scheduled_change: { action: string; effective_at: string } | null;
  canceled_at: string | null;
};

type PaddleTransaction = {
  id: string;
  status: string;
  subscription_id: string | null;
  customer_id: string | null;
  custom_data?: Record<string, unknown> | null;
  currency_code: string;
  /** Why Paddle made it: `subscription_recurring` renews, `subscription_update`
   *  charges for a change; anything else began the subscription. */
  origin: string;
  details: {
    totals: { grand_total: string; tax?: string; fee?: string | null };
    line_items: Array<{
      id: string;
      price?: { id: string } | null;
      totals: { total: string };
    }>;
  } | null;
  items?: Array<{ price: { id: string } }>;
  /** The period it pays for. */
  billing_period?: { starts_at: string; ends_at: string } | null;
  billed_at: string | null;
  created_at: string;
  checkout: { url: string | null } | null;
  /** How it was paid, newest attempt first. */
  payments?: Array<{
    status: string;
    method_details: {
      type: string;
      card?: {
        type: string | null;
        last4: string | null;
        expiry_month: number | null;
        expiry_year: number | null;
      } | null;
    } | null;
  }>;
};

/** How a transaction was paid, from its captured payment. */
function methodOf(txn: PaddleTransaction | undefined): PaymentMethod | null {
  const paid =
    txn?.payments?.find(p => p.status === 'captured') ?? txn?.payments?.[0];
  const details = paid?.method_details;
  if (!details) return null;
  return {
    type: details.type,
    brand: details.card?.type ?? null,
    last4: details.card?.last4 ?? null,
    expMonth: details.card?.expiry_month ?? null,
    expYear: details.card?.expiry_year ?? null
  };
}

type PaddleAdjustment = {
  id: string;
  action: string;
  type: 'full' | 'partial';
  status: 'pending_approval' | 'approved' | 'rejected' | 'reversed';
  transaction_id: string;
  currency_code?: string;
  items: Array<{ item_id: string; amount: string }>;
  totals: { total: string };
};

/**
 * Where a partial refund of `minor` goes in a transaction: Paddle refunds by
 * line item, each up to what is left of it. Only the lines that charged —
 * an upgrade's transaction also carries a line crediting the old plan.
 */
function refundItems(
  lines: Array<{ id: string; totals: { total: string } }>,
  earlier: PaddleAdjustment[],
  minor: number
): Array<{ item_id: string; type: 'partial'; amount: string }> {
  const taken = new Map<string, number>();
  for (const adj of earlier) {
    // A refund still waiting for approval holds its amount too.
    if (adj.status !== 'approved' && adj.status !== 'pending_approval')
      continue;
    for (const item of adj.items) {
      taken.set(
        item.item_id,
        (taken.get(item.item_id) ?? 0) + Number(item.amount)
      );
    }
  }
  const items: Array<{ item_id: string; type: 'partial'; amount: string }> = [];
  let left = minor;
  for (const line of lines) {
    if (left <= 0) break;
    const room = Number(line.totals.total) - (taken.get(line.id) ?? 0);
    if (room <= 0) continue;
    const amount = Math.min(room, left);
    items.push({ item_id: line.id, type: 'partial', amount: String(amount) });
    left -= amount;
  }
  if (left > 0) {
    throw new PublicError('The refund is more than is left of this payment.');
  }
  return items;
}

const kindOf = (origin: string): PaymentKind =>
  origin === 'subscription_recurring'
    ? 'renewal'
    : origin === 'subscription_update'
      ? 'upgrade'
      : 'initial';

const dateOf = (iso: string | null | undefined) => (iso ? new Date(iso) : null);

const textOf = (value: unknown) =>
  typeof value === 'string' && value ? value : null;

/**
 * Paddle's status in the app's words. With a cancellation scheduled for the
 * end of the period, a subscription is still `active`. Past due, a renewal
 * failed and Paddle is retrying it: still `active`, its payment failed —
 * Paddle cancels it itself when the retries are used up.
 */
function statusOf(
  sub: PaddleSubscription
): Pick<
  ProcessorSubscription,
  'status' | 'cancelAtPeriodEnd' | 'paymentFailed' | 'paused'
> {
  switch (sub.status) {
    case 'active':
    case 'trialing':
      return {
        status: 'active',
        cancelAtPeriodEnd: sub.scheduled_change?.action === 'cancel',
        paymentFailed: false
      };
    case 'paused':
      return {
        status: 'canceled',
        cancelAtPeriodEnd: false,
        paymentFailed: false,
        paused: true
      };
    case 'past_due':
      return {
        status: 'active',
        cancelAtPeriodEnd: sub.scheduled_change?.action === 'cancel',
        paymentFailed: true
      };
    default:
      return {
        status: 'canceled',
        cancelAtPeriodEnd: false,
        paymentFailed: false
      };
  }
}

function toSubscription(sub: PaddleSubscription): ProcessorSubscription {
  return {
    externalId: sub.id,
    customerId: sub.customer_id,
    userId: textOf(sub.custom_data?.userId),
    planId: textOf(sub.custom_data?.planId),
    priceId: sub.items[0]?.price.id ?? null,
    ...statusOf(sub),
    // Paddle stops saying the period once a subscription is cancelled.
    expiresAt: dateOf(sub.current_billing_period?.ends_at)
  };
}

/** Checked against the raw body: `ts=…;h1=…`, an HMAC-SHA256 of
 *  `ts:body` with the endpoint's secret, sent within five minutes. */
function verifySignature(payload: string, header: string, secret: string) {
  const parts = Object.fromEntries(
    header.split(';').map(part => part.split('=', 2) as [string, string])
  );
  const ts = Number(parts.ts);
  if (!ts || !parts.h1)
    throw new WebhookSignatureError('Bad Paddle signature.');
  if (Math.abs(Date.now() / 1000 - ts) > 300) {
    throw new WebhookSignatureError('Paddle signature is too old.');
  }
  const expected = createHmac('sha256', secret)
    .update(`${ts}:${payload}`)
    .digest('hex');
  const given = Buffer.from(parts.h1, 'hex');
  const want = Buffer.from(expected, 'hex');
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    throw new WebhookSignatureError('Bad Paddle signature.');
  }
}

type PaddleEvent = {
  event_id: string;
  event_type: string;
  data: Record<string, any>;
};

/** A transaction as a payment, as it comes in a webhook or is read. */
function toPayment(txn: PaddleTransaction): ProcessorPayment | null {
  const total = Number(txn.details?.totals.grand_total ?? 0);
  // Nothing to pay — a trial's first transaction — is not a payment.
  if (total === 0) return null;
  return {
    externalId: txn.id,
    customerId: txn.customer_id,
    externalSubscriptionId: txn.subscription_id,
    userId: textOf(txn.custom_data?.userId),
    planId: textOf(txn.custom_data?.planId),
    priceId:
      txn.items?.[0]?.price.id ??
      txn.details?.line_items?.[0]?.price?.id ??
      null,
    periodEnd: dateOf(txn.billing_period?.ends_at),
    // Refunds and chargebacks name the transaction itself.
    transactionId: txn.id,
    amount: toAmount(total),
    kind: kindOf(txn.origin),
    fee:
      txn.details?.totals.fee != null
        ? toAmount(Number(txn.details.totals.fee))
        : null,
    // Paddle sells as the merchant: it collects the tax and returns it with
    // a refund.
    tax: toAmount(Number(txn.details?.totals.tax ?? 0)),
    paid: txn.status === 'completed' || txn.status === 'paid',
    invoiceUrl: null,
    billedAt: dateOf(txn.billed_at) ?? dateOf(txn.created_at) ?? new Date()
  };
}

/** A Paddle refund adjustment as the app sees it. */
function toRefund(adjustment: PaddleAdjustment): ProcessorRefund {
  return {
    externalId: adjustment.id,
    amount: toAmount(Number(adjustment.totals?.total ?? 0)),
    total: null,
    status:
      adjustment.status === 'approved'
        ? 'succeeded'
        : adjustment.status === 'pending_approval'
          ? 'pending'
          : 'failed'
  };
}

/** What a webhook says: the object it carries, as it is, and when. */
function actionOf(event: PaddleEvent): WebhookAction {
  const { event_type: type, data } = event;
  if (type.startsWith('subscription.')) {
    return {
      kind: 'subscription',
      subscription: toSubscription(data as PaddleSubscription)
    };
  }
  if (
    type === 'transaction.completed' ||
    type === 'transaction.payment_failed'
  ) {
    const payment = toPayment(data as PaddleTransaction);
    return payment ? { kind: 'payment', payment } : { kind: 'ignore' };
  }
  if (type === 'adjustment.created' || type === 'adjustment.updated') {
    if (data.action === 'refund') {
      return {
        kind: 'refund',
        transactionId: data.transaction_id,
        refund: toRefund(data as PaddleAdjustment)
      };
    }
    // A chargeback, or Paddle's own refund to head one off: the money has
    // left either way.
    if (data.action === 'chargeback' || data.action === 'chargeback_warning') {
      return {
        kind: 'dispute',
        transactionId: data.transaction_id,
        withdrawn: true
      };
    }
    if (
      data.action === 'chargeback_reverse' ||
      data.action === 'chargeback_warning_reverse'
    ) {
      return { kind: 'dispute_won', transactionId: data.transaction_id };
    }
  }
  return { kind: 'ignore' };
}

const intervalOf = (cycle: PaddlePrice['billing_cycle']) =>
  cycle?.frequency === 1 &&
  (cycle.interval === 'month' || cycle.interval === 'year')
    ? cycle.interval
    : null;

/** A transaction's refunds, whatever their state. */
async function refundsOf(transactionId: string) {
  return await paddle<PaddleAdjustment[]>(
    'GET',
    `/adjustments?transaction_id=${transactionId}&action=refund&per_page=50`
  );
}

export function createPaddleProcessor(): PaymentProcessor {
  const getSubscription = async (id: string) =>
    await paddle<PaddleSubscription>('GET', `/subscriptions/${id}`);

  return {
    id: 'paddle',

    async getPrice(priceId): Promise<ProcessorPrice> {
      let price: PaddlePrice;
      try {
        price = await paddle<PaddlePrice>('GET', `/prices/${priceId}`);
      } catch (err) {
        if (err instanceof PaddleError && err.status === 404) {
          throw new PublicError(`Paddle has no price ${priceId}.`);
        }
        throw err;
      }
      return {
        priceId: price.id,
        amount: toAmount(Number(price.unit_price.amount)),
        interval: intervalOf(price.billing_cycle),
        active: price.status === 'active',
        metered: false,
        // Paddle's checkout lets the buyer change the quantity up to this.
        maxQuantity: price.quantity?.maximum ?? 1
      };
    },

    async createCheckout(input) {
      const transaction = await paddle<PaddleTransaction>(
        'POST',
        '/transactions',
        {
          items: [{ price_id: input.priceId, quantity: 1 }],
          // Paid under the email the user signed up with.
          customer_id: input.customerId ?? (await customerFor(input.email)),
          custom_data: { userId: input.userId, planId: input.planId },
          // The app's page that runs Paddle.js, which opens the checkout
          // for the `?_ptxn=` Paddle adds.
          checkout: { url: `${input.origin}/pay/paddle` }
        }
      );
      if (!transaction.checkout?.url) {
        throw new PublicError('Paddle did not open a checkout.');
      }
      return transaction.checkout.url;
    },

    async getPaymentMethod(subscription) {
      // Paddle keeps the method on the payments it takes: the latest one
      // for the subscription is how it is paid for now.
      const [latest] = await paddle<PaddleTransaction[]>(
        'GET',
        `/transactions?subscription_id=${subscription.externalId}&status=completed,paid&order_by=billed_at[DESC]&per_page=1`
      );
      return methodOf(latest);
    },

    async paymentMethodsUrl(subscription) {
      const session = await paddle<{
        urls: {
          general: { overview: string };
          subscriptions: Array<{
            id: string;
            update_subscription_payment_method: string;
          }>;
        };
      }>('POST', `/customers/${subscription.customerId}/portal-sessions`, {
        subscription_ids: [subscription.externalId]
      });
      return (
        session.urls.subscriptions.find(s => s.id === subscription.externalId)
          ?.update_subscription_payment_method ?? session.urls.general.overview
      );
    },

    async getSubscription(externalId) {
      return toSubscription(await getSubscription(externalId));
    },

    async findSubscriptions({ ref, userId }) {
      // The checkout's return carries its transaction (`_ptxn`).
      if (!ref) return [];
      const txn = await paddle<PaddleTransaction>(
        'GET',
        `/transactions/${encodeURIComponent(ref)}`
      );
      if (textOf(txn.custom_data?.userId) !== userId) return [];
      return txn.subscription_id ? [txn.subscription_id] : [];
    },

    async previewChange(externalId, target) {
      const preview = await paddle<{
        immediate_transaction: {
          details: {
            totals: { grand_total: string; currency_code: string };
          } | null;
        } | null;
      }>('PATCH', `/subscriptions/${externalId}/preview`, {
        items: [{ price_id: target.priceId, quantity: 1 }],
        proration_billing_mode: 'prorated_immediately'
      });
      const totals = preview.immediate_transaction?.details?.totals;
      return totals ? toAmount(Number(totals.grand_total)) : null;
    },

    async changeNow(externalId, target) {
      const sub = await getSubscription(externalId);
      // Switching is choosing to stay: a cancellation waiting is dropped
      // first. Paddle takes that alone, never beside a change of items.
      const wasCanceling = sub.scheduled_change?.action === 'cancel';
      if (sub.scheduled_change) {
        await paddle('PATCH', `/subscriptions/${externalId}`, {
          scheduled_change: null
        });
      }
      try {
        await paddle('PATCH', `/subscriptions/${externalId}`, {
          items: [{ price_id: target.priceId, quantity: 1 }],
          // Charged at once; a charge that fails leaves the plan as it was.
          proration_billing_mode: 'prorated_immediately',
          on_payment_failure: 'prevent_change',
          custom_data: { ...(sub.custom_data ?? {}), planId: target.planId }
        });
      } catch (err) {
        // Nothing changed: the cancellation it had is put back.
        if (wasCanceling) {
          await paddle('POST', `/subscriptions/${externalId}/cancel`, {
            effective_from: 'next_billing_period'
          }).catch(e =>
            console.error(
              `[paddle] could not restore the cancellation of ${externalId}`,
              e
            )
          );
        }
        if (err instanceof PaddleError && err.status < 500) {
          console.warn(`[paddle] change of ${externalId} refused`, err.message);
          throw new PublicError(
            /payment|declin|card/i.test(err.code ?? '')
              ? 'The payment for this change did not go through, so your plan has not changed.'
              : 'This change could not be made right now, so your plan has not changed.'
          );
        }
        throw err;
      }
    },

    async cancelAtPeriodEnd(externalId) {
      await paddle('POST', `/subscriptions/${externalId}/cancel`, {
        effective_from: 'next_billing_period'
      });
    },

    async resume(externalId) {
      await paddle('PATCH', `/subscriptions/${externalId}`, {
        scheduled_change: null
      });
    },

    async cancelNow(externalId) {
      const sub = await getSubscription(externalId);
      if (sub.status === 'canceled') return;
      // Paddle refuses to cancel one with a change scheduled — a cancel at
      // the period end, say — until that is dropped.
      if (sub.scheduled_change) {
        await paddle('PATCH', `/subscriptions/${externalId}`, {
          scheduled_change: null
        });
      }
      await paddle('POST', `/subscriptions/${externalId}/cancel`, {
        effective_from: 'immediately'
      });
    },

    async refundPayment(payment, refund) {
      const reason = 'Refund requested.';
      if (refund.whole) {
        const made = await paddle<PaddleAdjustment>('POST', '/adjustments', {
          action: 'refund',
          transaction_id: payment.externalId,
          reason,
          type: 'full'
        });
        return { externalId: made.id };
      }
      const [txn, earlier] = await Promise.all([
        paddle<PaddleTransaction>('GET', `/transactions/${payment.externalId}`),
        refundsOf(payment.externalId)
      ]);
      const made = await paddle<PaddleAdjustment>('POST', '/adjustments', {
        action: 'refund',
        transaction_id: payment.externalId,
        reason,
        type: 'partial',
        items: refundItems(txn.details?.line_items ?? [], earlier, refund.minor)
      });
      return { externalId: made.id };
    },

    async dashboardUrl(externalId) {
      const { sandbox } = await paddleKeys();
      const host = sandbox
        ? 'sandbox-vendors.paddle.com'
        : 'vendors.paddle.com';
      return `https://${host}/subscriptions-v2/${externalId}`;
    },

    async getRefund(_payment, externalRefundId) {
      return toRefund(
        await paddle<PaddleAdjustment>(
          'GET',
          `/adjustments/${externalRefundId}`
        )
      );
    },

    async getPayment(externalId): Promise<ProcessorPayment | null> {
      return toPayment(
        await paddle<PaddleTransaction>('GET', `/transactions/${externalId}`)
      );
    },

    async invoiceUrl(externalId) {
      // Paddle makes the PDF when asked, behind a link that lasts an hour.
      const invoice = await paddle<{ url: string }>(
        'GET',
        `/transactions/${externalId}/invoice?disposition=inline`
      );
      return invoice.url ?? null;
    },

    async parseWebhook(payload, headers) {
      const { webhookSecret } = await paddleKeys();
      if (!webhookSecret) {
        throw new PublicError('Paddle webhooks are not configured.');
      }
      const signature = headers.get('paddle-signature');
      if (!signature) throw new WebhookSignatureError('No Paddle signature.');
      verifySignature(payload, signature, webhookSecret);
      const event = JSON.parse(payload) as PaddleEvent;
      return {
        id: event.event_id,
        type: event.event_type,
        action: actionOf(event)
      };
    }
  };
}

export const __test = {
  methodOf,
  verifySignature,
  actionOf,
  toSubscription,
  refundItems
};
