import '@tanstack/react-start/server-only';

import Stripe from 'stripe';

import {
  toAmount,
  type BillingInterval,
  type PaymentKind,
  type ProcessorPrice
} from '@/types/payment';
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
 * Stripe, as a payment processor.
 *
 * A plan's price is a Stripe Price. Checkout sells it; the subscription it
 * makes carries the user and plan in its metadata. An upgrade is a
 * subscription update charged at once.
 */

let cached: { key: string; client: Stripe } | undefined;

async function stripeKeys() {
  // Imported here: importing `env` validates the whole environment, and
  // tests reach this module with none.
  const { env } = await import('@/lib/env');
  return {
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET
  };
}

async function client(): Promise<Stripe> {
  const { secretKey } = await stripeKeys();
  if (!secretKey) throw new PublicError('Stripe is not configured.');
  if (cached?.key !== secretKey) {
    cached = { key: secretKey, client: new Stripe(secretKey) };
  }
  return cached.client;
}

const idOf = (ref: string | { id: string } | null | undefined) =>
  ref == null ? null : typeof ref === 'string' ? ref : ref.id;

const dateOf = (seconds: number | null | undefined) =>
  seconds ? new Date(seconds * 1000) : null;

/** The interval a price renews at: every one month or one year. Every three
 *  months, say, is none a plan is sold at. */
const intervalOf = (
  recurring: Stripe.Price.Recurring | null | undefined
): BillingInterval | null => {
  if (recurring?.interval_count !== 1) return null;
  return recurring.interval === 'month'
    ? 'month'
    : recurring.interval === 'year'
      ? 'year'
      : null;
};

/**
 * Stripe's status in the app's words. Set to stop at the end of the period,
 * a subscription is still `active`. Past due, a renewal failed and Stripe
 * is retrying it: still `active`, its payment failed. Unpaid, the retries
 * are used up: over.
 */
function statusOf(
  sub: Stripe.Subscription
): Pick<
  ProcessorSubscription,
  'status' | 'cancelAtPeriodEnd' | 'paymentFailed' | 'paused'
> {
  switch (sub.status) {
    case 'active':
    case 'trialing':
      return {
        status: 'active',
        cancelAtPeriodEnd: sub.cancel_at_period_end || !!sub.cancel_at,
        paymentFailed: false
      };
    case 'incomplete':
      return {
        status: 'incomplete',
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
      return {
        status: 'active',
        cancelAtPeriodEnd: sub.cancel_at_period_end || !!sub.cancel_at,
        paymentFailed: true
      };
    // Retries used up and the subscription left standing, unpaid: still
    // there, still not paid for. Its failed payments say what becomes of it.
    case 'unpaid':
      return {
        status: 'active',
        cancelAtPeriodEnd: sub.cancel_at_period_end || !!sub.cancel_at,
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

async function retrieveSubscription(stripe: Stripe, id: string) {
  return await stripe.subscriptions.retrieve(id);
}

function toSubscription(sub: Stripe.Subscription): ProcessorSubscription {
  const item = sub.items.data[0];
  return {
    externalId: sub.id,
    customerId: idOf(sub.customer) ?? '',
    userId: sub.metadata?.userId || null,
    planId: sub.metadata?.planId || null,
    priceId: item?.price.id ?? null,
    ...statusOf(sub),
    expiresAt: dateOf(item?.current_period_end)
  };
}

/** The transaction that paid an invoice — its PaymentIntent — which
 *  refunds and disputes name. */
function transactionIdOf(invoice: Stripe.Invoice): string | null {
  const payment = invoice.payments?.data.find(
    p => p.status === 'paid' || p.is_default
  )?.payment;
  return idOf(payment?.payment_intent) ?? idOf(payment?.charge) ?? null;
}

/** An invoice as a payment, as it comes in a webhook or is read. The fee
 *  is read apart, when a refund needs it. */
function toPayment(invoice: Stripe.Invoice): ProcessorPayment | null {
  const paid = invoice.status === 'paid';
  const amount = paid ? invoice.amount_paid : invoice.amount_due;
  // Nothing to pay — a trial's first invoice — is not a payment.
  if (amount === 0) return null;
  const line = invoice.lines?.data[0];
  const details = invoice.parent?.subscription_details ?? null;
  const metadata: Record<string, string> | null = details?.metadata ?? null;
  return {
    externalId: invoice.id,
    customerId: idOf(invoice.customer),
    externalSubscriptionId: idOf(details?.subscription),
    userId: metadata?.userId || null,
    planId: metadata?.planId || null,
    priceId: idOf(line?.pricing?.price_details?.price) ?? null,
    periodEnd: dateOf(line?.period?.end),
    transactionId: transactionIdOf(invoice),
    amount: toAmount(amount),
    kind: kindOf(invoice.billing_reason),
    fee: null,
    // Tax on a Stripe invoice is the seller's to hand back, not Stripe's.
    tax: null,
    paid,
    invoiceUrl: invoice.hosted_invoice_url ?? null,
    billedAt:
      dateOf(invoice.status_transitions?.paid_at) ??
      dateOf(invoice.created) ??
      new Date()
  };
}

/**
 * The fee Stripe kept on a charge, from its balance transaction. Null when
 * it cannot be read; a refund then gives back all that was paid.
 */
async function feeOf(stripe: Stripe, ref: string | null) {
  if (!ref) return null;
  try {
    const charge = ref.startsWith('pi_')
      ? (
          await stripe.paymentIntents.retrieve(ref, {
            expand: ['latest_charge.balance_transaction']
          })
        ).latest_charge
      : await stripe.charges.retrieve(ref, {
          expand: ['balance_transaction']
        });
    const txn =
      charge && typeof charge === 'object' ? charge.balance_transaction : null;
    if (!txn || typeof txn !== 'object') return null;
    return toAmount(txn.fee);
  } catch (err) {
    console.warn(`[stripe] no fee for ${ref}`, err);
    return null;
  }
}

/** What an invoice paid for, by why Stripe made it. */
function kindOf(reason: Stripe.Invoice['billing_reason']): PaymentKind {
  if (reason === 'subscription_cycle') return 'renewal';
  if (reason === 'subscription_update') return 'upgrade';
  return 'initial';
}

/** A Stripe refund as the app sees it. */
function toRefund(refund: Stripe.Refund): ProcessorRefund {
  return {
    externalId: refund.id,
    amount: toAmount(refund.amount),
    total: null,
    status:
      refund.status === 'succeeded'
        ? 'succeeded'
        : refund.status === 'failed' || refund.status === 'canceled'
          ? 'failed'
          : 'pending'
  };
}

/** What a webhook says: the object it carries, as it is, and when. */
function actionOf(event: Stripe.Event): WebhookAction {
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      return {
        kind: 'subscription',
        subscription: toSubscription(event.data.object)
      };
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const payment = toPayment(event.data.object);
      return payment ? { kind: 'payment', payment } : { kind: 'ignore' };
    }
    case 'refund.created':
    case 'refund.updated': {
      // The refund itself, by its id — the one `refunds.create` returned,
      // or one made in the Dashboard.
      const refund = event.data.object;
      const ref = idOf(refund.payment_intent) ?? idOf(refund.charge);
      if (!ref) return { kind: 'ignore' };
      return { kind: 'refund', transactionId: ref, refund: toRefund(refund) };
    }
    case 'charge.dispute.created':
    case 'charge.dispute.funds_withdrawn': {
      const dispute = event.data.object;
      const ref = idOf(dispute.payment_intent) ?? idOf(dispute.charge);
      if (!ref) return { kind: 'ignore' };
      return {
        kind: 'dispute',
        transactionId: ref,
        // An inquiry (`warning_…`) has taken no money yet.
        withdrawn:
          event.type === 'charge.dispute.funds_withdrawn' ||
          !dispute.status.startsWith('warning_')
      };
    }
    case 'charge.dispute.funds_reinstated':
    case 'charge.dispute.closed': {
      const dispute = event.data.object;
      const ref = idOf(dispute.payment_intent) ?? idOf(dispute.charge);
      const won =
        event.type === 'charge.dispute.funds_reinstated' ||
        dispute.status === 'won' ||
        dispute.status === 'warning_closed';
      return ref && won
        ? { kind: 'dispute_won', transactionId: ref }
        : { kind: 'ignore' };
    }
    default:
      return { kind: 'ignore' };
  }
}

export function createStripeProcessor(): PaymentProcessor {
  return {
    id: 'stripe',

    async getPrice(priceId): Promise<ProcessorPrice> {
      const stripe = await client();
      let price: Stripe.Price;
      try {
        price = await stripe.prices.retrieve(priceId);
      } catch {
        throw new PublicError(`Stripe has no price ${priceId}.`);
      }
      return {
        priceId: price.id,
        amount: price.unit_amount == null ? null : toAmount(price.unit_amount),
        interval: intervalOf(price.recurring),
        active: price.active,
        metered: price.recurring?.usage_type === 'metered',
        // The checkout the app makes sells one, not adjustable.
        maxQuantity: null
      };
    },

    async createCheckout(input) {
      const stripe = await client();
      const metadata = { userId: input.userId, planId: input.planId };
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: input.customerId ?? undefined,
        customer_email: input.customerId ? undefined : input.email,
        line_items: [{ price: input.priceId, quantity: 1 }],
        client_reference_id: input.userId,
        metadata,
        subscription_data: { metadata },
        // Stripe fills in the session, which names the subscription it made.
        success_url: `${input.successUrl}&ref={CHECKOUT_SESSION_ID}`,
        cancel_url: input.cancelUrl
      });
      if (!session.url)
        throw new PublicError('Stripe did not open a checkout.');
      return session.url;
    },

    async getPaymentMethod(subscription): Promise<PaymentMethod | null> {
      const stripe = await client();
      const sub = await stripe.subscriptions.retrieve(subscription.externalId, {
        expand: [
          'default_payment_method',
          'customer.invoice_settings.default_payment_method'
        ]
      });
      // The subscription's own method, else the customer's default.
      const customer = sub.customer;
      const method =
        sub.default_payment_method ??
        (customer && typeof customer === 'object' && !customer.deleted
          ? customer.invoice_settings.default_payment_method
          : null);
      if (!method || typeof method !== 'object') return null;
      return {
        type: method.type,
        brand: method.card?.brand ?? null,
        last4: method.card?.last4 ?? null,
        expMonth: method.card?.exp_month ?? null,
        expYear: method.card?.exp_year ?? null
      };
    },

    async paymentMethodsUrl(subscription, returnUrl) {
      const stripe = await client();
      const session = await stripe.billingPortal.sessions.create({
        customer: subscription.customerId,
        return_url: returnUrl,
        configuration: await paymentMethodsPortal(stripe)
      });
      return session.url;
    },

    async getSubscription(externalId) {
      const stripe = await client();
      return toSubscription(await retrieveSubscription(stripe, externalId));
    },

    async findSubscriptions({ ref, userId }) {
      if (!ref) return [];
      const stripe = await client();
      const session = await stripe.checkout.sessions.retrieve(ref);
      if (session.client_reference_id !== userId) return [];
      const id = idOf(session.subscription);
      return id ? [id] : [];
    },

    async previewChange(externalId, target) {
      const stripe = await client();
      const sub = await retrieveSubscription(stripe, externalId);
      const item = sub.items.data[0];
      if (!item) return null;
      const preview = await stripe.invoices.createPreview({
        subscription: externalId,
        subscription_details: {
          items: [{ id: item.id, price: target.priceId }],
          proration_behavior: 'always_invoice'
        }
      });
      return toAmount(preview.amount_due);
    },

    async changeNow(externalId, target) {
      const stripe = await client();
      const sub = await retrieveSubscription(stripe, externalId);
      const item = sub.items.data[0];
      if (!item) throw new PublicError('This subscription has no price.');

      // What costs nothing goes first, and back if the change does not go
      // through: a switch is choosing to stay, under the plan named. Stripe
      // takes these apart from a change held back on payment.
      await stripe.subscriptions.update(externalId, {
        cancel_at_period_end: false,
        metadata: { planId: target.planId }
      });
      // Then the change, charged at once and last, so nothing after it can
      // fail: if the charge fails it is held back rather than applied, and
      // a declined card leaves the plan as it was.
      let updated: Stripe.Subscription;
      try {
        updated = await stripe.subscriptions.update(externalId, {
          items: [{ id: item.id, price: target.priceId }],
          proration_behavior: 'always_invoice',
          payment_behavior: 'pending_if_incomplete'
        });
      } catch (err) {
        await restore();
        throw err;
      }
      if (updated.pending_update) {
        await restore();
        throw new PublicError(
          'The payment for this change did not go through, so your plan has not changed.'
        );
      }

      /** Put back what went first. */
      async function restore() {
        await stripe.subscriptions
          .update(externalId, {
            cancel_at_period_end: sub.cancel_at_period_end,
            metadata: { planId: sub.metadata?.planId ?? '' }
          })
          .catch((e: unknown) =>
            console.error(`[stripe] could not restore ${externalId}`, e)
          );
      }
    },

    async cancelAtPeriodEnd(externalId) {
      const stripe = await client();
      await stripe.subscriptions.update(externalId, {
        cancel_at_period_end: true
      });
    },

    async resume(externalId) {
      const stripe = await client();
      await stripe.subscriptions.update(externalId, {
        cancel_at_period_end: false
      });
    },

    async cancelNow(externalId) {
      const stripe = await client();
      const sub = await stripe.subscriptions.retrieve(externalId);
      if (sub.status === 'canceled' || sub.status === 'incomplete_expired') {
        return;
      }
      await stripe.subscriptions.cancel(externalId);
    },

    async refundPayment(payment, refund) {
      const stripe = await client();
      const ref = payment.transactionId;
      if (!ref) {
        throw new PublicError('This payment has no transaction to refund.');
      }
      const made = await stripe.refunds.create({
        ...(ref.startsWith('pi_') ? { payment_intent: ref } : { charge: ref }),
        // No amount: whatever of the charge is left.
        ...(refund.whole ? {} : { amount: refund.minor }),
        reason: 'requested_by_customer'
      });
      return { externalId: made.id };
    },

    async dashboardUrl(externalId) {
      const { secretKey } = await stripeKeys();
      const test = secretKey?.startsWith('sk_test_') ? 'test/' : '';
      return `https://dashboard.stripe.com/${test}subscriptions/${externalId}`;
    },

    async getRefund(_payment, externalRefundId) {
      const stripe = await client();
      return toRefund(await stripe.refunds.retrieve(externalRefundId));
    },

    async getPayment(externalId): Promise<ProcessorPayment | null> {
      const stripe = await client();
      const invoice = await stripe.invoices.retrieve(externalId, {
        expand: ['payments']
      });
      const payment = toPayment(invoice);
      if (!payment) return null;
      return {
        ...payment,
        fee: payment.paid ? await feeOf(stripe, payment.transactionId) : null
      };
    },

    async parseWebhook(payload, headers) {
      const stripe = await client();
      const { webhookSecret } = await stripeKeys();
      if (!webhookSecret) {
        throw new PublicError('Stripe webhooks are not configured.');
      }
      const signature = headers.get('stripe-signature');
      if (!signature) throw new WebhookSignatureError('No Stripe signature.');
      let event: Stripe.Event;
      try {
        event = await stripe.webhooks.constructEventAsync(
          payload,
          signature,
          webhookSecret
        );
      } catch (err) {
        throw new WebhookSignatureError(
          err instanceof Error ? err.message : 'Bad Stripe signature.'
        );
      }
      return { id: event.id, type: event.type, action: actionOf(event) };
    }
  };
}

/**
 * The billing portal as the app opens it: for the card and the invoices only.
 * Changing and cancelling the plan happen in the app, where its rules are, so
 * the portal must not offer them. Made once in the Stripe account and found
 * again by its metadata.
 */
const PORTAL_PURPOSE = 'payment-methods';

async function paymentMethodsPortal(stripe: Stripe): Promise<string> {
  const existing = await stripe.billingPortal.configurations.list({
    active: true,
    limit: 100
  });
  const found = existing.data.find(c => c.metadata?.purpose === PORTAL_PURPOSE);
  if (found) return found.id;

  const created = await stripe.billingPortal.configurations.create({
    metadata: { purpose: PORTAL_PURPOSE },
    features: {
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      customer_update: { enabled: false },
      subscription_cancel: { enabled: false },
      subscription_update: { enabled: false }
    }
  });
  return created.id;
}
