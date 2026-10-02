import '@tanstack/react-start/server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { type PaymentKind, type ProcessorPrice } from '@/types/payment';
import { type env as Env } from '@/lib/env';
import { PublicError } from '@/server/public-error';
import {
  toMajorUnits,
  WebhookSignatureError,
  type PaymentMethod,
  type PaymentProcessor,
  type ProcessorPayment,
  type ProcessorSubscription,
  type WebhookAction
} from '@/server/services/payment-processor';

/**
 * Lemon Squeezy, as a payment processor.
 *
 * A plan's price is a variant, named by its ID; what it charges is the
 * variant's price model, in the store's currency. Checkout is a checkout
 * link made for the user, which carries the user and plan as custom data —
 * and only the webhooks repeat it, since a subscription does not keep it.
 *
 * Lemon Squeezy has no way to cancel a subscription at once: cancelling
 * runs to the end of the period. The subscription service makes up for it.
 */

type LemonKeys = {
  apiKey: string;
  webhookSecret: string | undefined;
  storeId: string | undefined;
};

let envModule: Promise<{ env: typeof Env }> | undefined;

async function lemonKeys(): Promise<LemonKeys> {
  // Imported here: importing `env` validates the whole environment, and
  // tests reach this module with none. Once, and shared by calls made
  // together.
  const { env } = await (envModule ??= import('@/lib/env'));
  if (!env.LEMONSQUEEZY_API_KEY) {
    throw new PublicError('Lemon Squeezy is not configured.');
  }
  return {
    apiKey: env.LEMONSQUEEZY_API_KEY,
    webhookSecret: env.LEMONSQUEEZY_WEBHOOK_SECRET,
    storeId: env.LEMONSQUEEZY_STORE_ID
  };
}

async function requireStoreId(): Promise<string> {
  const { storeId } = await lemonKeys();
  if (!storeId) throw new PublicError('Lemon Squeezy has no store set.');
  return storeId;
}

class LemonError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

type Resource<T> = { type: string; id: string; attributes: T };

async function lemon<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const { apiKey } = await lemonKeys();
  const res = await fetch(`https://api.lemonsqueezy.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    errors?: Array<{ detail?: string; title?: string }>;
  };
  if (!res.ok) {
    const detail = json.errors?.[0]?.detail ?? json.errors?.[0]?.title;
    throw new LemonError(
      res.status,
      `Lemon Squeezy ${method} ${path} failed (${res.status}): ${detail ?? 'no detail'}`
    );
  }
  return json.data as T;
}

type LemonSubscription = Resource<{
  store_id: number;
  customer_id: number;
  variant_id: number;
  status:
    | 'on_trial'
    | 'active'
    | 'paused'
    | 'past_due'
    | 'unpaid'
    | 'cancelled'
    | 'expired';
  cancelled: boolean;
  renews_at: string | null;
  ends_at: string | null;
  updated_at: string;
  /** `stripe` for a card, or `paypal`. */
  payment_processor: string | null;
  card_brand: string | null;
  card_last_four: string | null;
  urls: { update_payment_method: string; customer_portal: string };
}>;

/** How a subscription is paid for. Lemon Squeezy says a card's brand and
 *  last four digits, not its expiry. */
function methodOf(sub: LemonSubscription): PaymentMethod | null {
  const a = sub.attributes;
  if (a.card_brand || a.card_last_four) {
    return {
      type: 'card',
      brand: a.card_brand,
      last4: a.card_last_four,
      expMonth: null,
      expYear: null
    };
  }
  return a.payment_processor === 'paypal'
    ? {
        type: 'paypal',
        brand: null,
        last4: null,
        expMonth: null,
        expYear: null
      }
    : null;
}

type LemonInvoice = Resource<{
  subscription_id: number;
  customer_id: number;
  status: 'pending' | 'paid' | 'void' | 'refunded' | 'partial_refund';
  /** Why it was made: `initial`, `renewal` or `updated`. */
  billing_reason: string;
  total: number;
  /** The tax in the total, collected by Lemon Squeezy as the merchant. */
  tax: number;
  currency: string;
  refunded: boolean;
  refunded_amount: number;
  created_at: string;
  updated_at: string;
  urls: { invoice_url: string | null };
}>;

const dateOf = (iso: string | null | undefined) => (iso ? new Date(iso) : null);

const kindOf = (reason: string): PaymentKind =>
  reason === 'renewal'
    ? 'renewal'
    : reason === 'updated'
      ? 'upgrade'
      : 'initial';

/**
 * Lemon Squeezy's status in the app's words. Its `cancelled` runs until
 * `ends_at` — the app's `active`, set to stop — and is over after, as its
 * `expired` is. Past due and unpaid are a failed payment, which cancels a
 * subscription at once.
 */
function statusOf(
  sub: LemonSubscription['attributes']
): Pick<
  ProcessorSubscription,
  'status' | 'cancelAtPeriodEnd' | 'paymentFailed' | 'paused'
> {
  switch (sub.status) {
    case 'active':
    case 'on_trial':
      return {
        status: 'active',
        cancelAtPeriodEnd: false,
        paymentFailed: false
      };
    case 'cancelled':
      return sub.ends_at && new Date(sub.ends_at) > new Date()
        ? { status: 'active', cancelAtPeriodEnd: true, paymentFailed: false }
        : {
            status: 'canceled',
            cancelAtPeriodEnd: false,
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
    case 'unpaid':
      return {
        status: 'canceled',
        cancelAtPeriodEnd: false,
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

function toSubscription(sub: LemonSubscription): ProcessorSubscription {
  const a = sub.attributes;
  return {
    externalId: sub.id,
    customerId: String(a.customer_id),
    // Only the webhooks carry the checkout's custom data.
    userId: null,
    planId: null,
    priceId: String(a.variant_id),
    ...statusOf(a),
    expiresAt: dateOf(a.cancelled ? a.ends_at : a.renews_at)
  };
}

/** An HMAC-SHA256 of the raw body with the webhook's signing secret, in hex. */
function verifySignature(payload: string, header: string, secret: string) {
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const given = Buffer.from(header, 'hex');
  const want = Buffer.from(expected, 'hex');
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    throw new WebhookSignatureError('Bad Lemon Squeezy signature.');
  }
}

type LemonEvent = {
  meta: { event_name: string; custom_data?: Record<string, unknown> | null };
  data: Resource<Record<string, any>>;
};

const textOf = (value: unknown) =>
  typeof value === 'string' && value ? value : null;

function actionOf(event: LemonEvent): WebhookAction {
  const name = event.meta.event_name;
  const { data } = event;
  switch (name) {
    case 'subscription_payment_success':
    case 'subscription_payment_recovered':
    case 'subscription_payment_failed':
      return { kind: 'payment', externalId: data.id };
    case 'subscription_payment_refunded':
      return {
        kind: 'refund',
        transactionId: data.id,
        refundAmount: toMajorUnits(
          Number(data.attributes.refunded_amount ?? 0),
          data.attributes.currency ?? 'USD'
        )
      };
    default:
      if (name.startsWith('subscription_')) {
        return {
          kind: 'subscription',
          externalId: data.id,
          hints: {
            userId: textOf(event.meta.custom_data?.user_id),
            planId: textOf(event.meta.custom_data?.plan_id)
          }
        };
      }
      return { kind: 'ignore' };
  }
}

const intervalOf = (unit: unknown, quantity: unknown) =>
  quantity === 1 && (unit === 'month' || unit === 'year') ? unit : null;

export function createLemonSqueezyProcessor(): PaymentProcessor {
  const getSubscription = async (id: string) =>
    await lemon<LemonSubscription>('GET', `/subscriptions/${id}`);

  const patch = async (id: string, attributes: Record<string, unknown>) =>
    await lemon('PATCH', `/subscriptions/${id}`, {
      data: { type: 'subscriptions', id, attributes }
    });

  return {
    id: 'lemonsqueezy',

    async getPrice(variantId): Promise<ProcessorPrice> {
      let variant: Resource<{ status: string; product_id: number }>;
      try {
        variant = await lemon('GET', `/variants/${variantId}`);
      } catch (err) {
        if (err instanceof LemonError && err.status === 404) {
          throw new PublicError(`Lemon Squeezy has no variant ${variantId}.`);
        }
        throw err;
      }
      const [price, store, product] = await Promise.all([
        lemon<
          Resource<{
            category: string;
            unit_price: number;
            renewal_interval_unit: string | null;
            renewal_interval_quantity: number | null;
            usage_aggregation: string | null;
          }>
        >('GET', `/variants/${variantId}/price-model`),
        lemon<Resource<{ currency: string }>>(
          'GET',
          `/stores/${await requireStoreId()}`
        ),
        lemon<Resource<{ status: string }>>(
          'GET',
          `/products/${variant.attributes.product_id}`
        )
      ]);
      const currency = store.attributes.currency;
      const recurring = price.attributes.category === 'subscription';
      return {
        priceId: variant.id,
        amount: toMajorUnits(price.attributes.unit_price, currency),
        currency: currency.toLowerCase(),
        interval: recurring
          ? intervalOf(
              price.attributes.renewal_interval_unit,
              price.attributes.renewal_interval_quantity
            )
          : null,
        // A product with no variants of its own sells its default one,
        // which stays `pending`; it is on sale while the product is.
        active:
          variant.attributes.status === 'published' ||
          (variant.attributes.status === 'pending' &&
            product.attributes.status === 'published'),
        metered: !!price.attributes.usage_aggregation,
        // The checkout the app makes sells one.
        maxQuantity: null
      };
    },

    async createCheckout(input) {
      const checkout = await lemon<Resource<{ url: string }>>(
        'POST',
        '/checkouts',
        {
          data: {
            type: 'checkouts',
            attributes: {
              checkout_data: {
                email: input.email,
                custom: { user_id: input.userId, plan_id: input.planId }
              },
              product_options: { redirect_url: input.successUrl }
            },
            relationships: {
              store: {
                data: { type: 'stores', id: await requireStoreId() }
              },
              variant: { data: { type: 'variants', id: input.priceId } }
            }
          }
        }
      );
      return checkout.attributes.url;
    },

    async getPaymentMethod(subscription) {
      return methodOf(await getSubscription(subscription.externalId));
    },

    async paymentMethodsUrl(subscription) {
      const sub = await getSubscription(subscription.externalId);
      return sub.attributes.urls.update_payment_method;
    },

    async getSubscription(externalId) {
      return toSubscription(await getSubscription(externalId));
    },

    // Lemon Squeezy switches the plan whether or not the charge for it goes
    // through, so its subscriptions are not upgraded in place.
    async changeNow() {
      throw new PublicError(
        'Plans bought through Lemon Squeezy cannot be switched in place.'
      );
    },

    async cancelAtPeriodEnd(externalId) {
      await lemon('DELETE', `/subscriptions/${externalId}`);
    },

    async resume(externalId) {
      await patch(externalId, { cancelled: false });
    },

    async cancelNow(externalId) {
      // As soon as it allows: cancelling here ends at the period's end, and
      // the subscription service keeps the plan away until then.
      const sub = await getSubscription(externalId);
      if (sub.attributes.cancelled || sub.attributes.status === 'expired') {
        return;
      }
      await lemon('DELETE', `/subscriptions/${externalId}`);
    },

    async refundPayment(payment, refund) {
      // Lemon Squeezy answers with the invoice, not a refund of its own.
      await lemon(
        'POST',
        `/subscription-invoices/${payment.externalId}/refund`,
        {
          data: {
            type: 'subscription-invoices',
            id: payment.externalId,
            // No amount: whatever of the invoice is left.
            attributes: refund.whole ? {} : { amount: refund.cents }
          }
        }
      );
    },

    async dashboardUrl(externalId) {
      return `https://app.lemonsqueezy.com/subscriptions/${externalId}`;
    },

    async getPayment(externalId): Promise<ProcessorPayment | null> {
      const invoice = await lemon<LemonInvoice>(
        'GET',
        `/subscription-invoices/${externalId}`
      );
      const a = invoice.attributes;
      // Nothing to pay — a trial's first invoice — is not a payment.
      if (!a.total) return null;
      return {
        externalId: invoice.id,
        customerId: String(a.customer_id),
        subscriptionExternalId: String(a.subscription_id),
        // Refunds name the invoice itself.
        transactionId: invoice.id,
        amount: toMajorUnits(a.total, a.currency),
        kind: kindOf(a.billing_reason),
        // Lemon Squeezy does not say its fee on an invoice.
        fee: null,
        tax: toMajorUnits(a.tax ?? 0, a.currency),
        currency: a.currency.toLowerCase(),
        paid: ['paid', 'refunded', 'partial_refund'].includes(a.status),
        invoiceUrl: a.urls.invoice_url,
        billedAt: dateOf(a.created_at) ?? new Date()
      };
    },

    async parseWebhook(payload, headers) {
      const { webhookSecret } = await lemonKeys();
      if (!webhookSecret) {
        throw new PublicError('Lemon Squeezy webhooks are not configured.');
      }
      const signature = headers.get('x-signature');
      if (!signature) {
        throw new WebhookSignatureError('No Lemon Squeezy signature.');
      }
      verifySignature(payload, signature, webhookSecret);
      const event = JSON.parse(payload) as LemonEvent;
      return {
        // Lemon Squeezy sends no event ID: the event, what it is about and
        // when that last changed name one delivery, and its retries alike.
        id: `${event.meta.event_name}:${event.data.id}:${event.data.attributes.updated_at ?? ''}`,
        type: event.meta.event_name,
        action: actionOf(event)
      };
    }
  };
}

export const __test = { verifySignature, actionOf, toSubscription, methodOf };
