import '@tanstack/react-start/server-only';

import Stripe from 'stripe';

import {
  type BillingInterval,
  type PaymentKind,
  type ProcessorPrice
} from '@/types/payment';
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

const intervalOf = (
  interval: string | null | undefined
): BillingInterval | null =>
  interval === 'month' ? 'month' : interval === 'year' ? 'year' : null;

/**
 * Stripe's status in the app's words. Set to stop at the end of the period,
 * a subscription is still `active`. Past due and unpaid are a failed
 * payment, which cancels a subscription at once.
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

/**
 * The fee Stripe kept on a charge, in dollars, from its balance
 * transaction. Null when it cannot be read or is not in dollars; a refund
 * then gives back all that was paid.
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
    if (!txn || typeof txn !== 'object' || txn.currency !== 'usd') return null;
    return toMajorUnits(txn.fee, txn.currency);
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

/** The subscription an event's object belongs to, where it says. */
function subscriptionOfInvoice(invoice: Stripe.Invoice): string | null {
  return idOf(invoice.parent?.subscription_details?.subscription);
}

function actionOf(event: Stripe.Event): WebhookAction {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const id = idOf(session.subscription);
      return session.mode === 'subscription' && id
        ? { kind: 'subscription', externalId: id }
        : { kind: 'ignore' };
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      return { kind: 'subscription', externalId: event.data.object.id };
    case 'invoice.paid':
    case 'invoice.payment_failed':
      return { kind: 'payment', externalId: event.data.object.id };
    case 'charge.refunded': {
      const charge = event.data.object;
      return {
        kind: 'refund',
        transactionId: idOf(charge.payment_intent) ?? charge.id,
        refundAmount: toMajorUnits(charge.amount_refunded, charge.currency)
      };
    }
    case 'refund.failed': {
      const refund = event.data.object;
      const ref = idOf(refund.payment_intent) ?? idOf(refund.charge);
      return ref
        ? { kind: 'refund_failed', transactionId: ref }
        : { kind: 'ignore' };
    }
    case 'charge.dispute.created': {
      const dispute = event.data.object;
      const ref = idOf(dispute.payment_intent) ?? idOf(dispute.charge);
      return ref ? { kind: 'dispute', transactionId: ref } : { kind: 'ignore' };
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
        amount:
          price.unit_amount == null
            ? null
            : toMajorUnits(price.unit_amount, price.currency),
        currency: price.currency,
        interval: intervalOf(price.recurring?.interval),
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
        success_url: input.successUrl,
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
      await stripe.refunds.create({
        ...(ref.startsWith('pi_') ? { payment_intent: ref } : { charge: ref }),
        // No amount: whatever of the charge is left.
        ...(refund.whole ? {} : { amount: refund.cents }),
        reason: 'requested_by_customer'
      });
    },

    async dashboardUrl(externalId) {
      const { secretKey } = await stripeKeys();
      const test = secretKey?.startsWith('sk_test_') ? 'test/' : '';
      return `https://dashboard.stripe.com/${test}subscriptions/${externalId}`;
    },

    async getPayment(externalId): Promise<ProcessorPayment | null> {
      const stripe = await client();
      const invoice = await stripe.invoices.retrieve(externalId, {
        expand: ['payments']
      });
      const paid = invoice.status === 'paid';
      const amount = paid ? invoice.amount_paid : invoice.amount_due;
      // Nothing to pay — a trial's first invoice — is not a payment.
      if (amount === 0) return null;
      const transactionId = transactionIdOf(invoice);
      return {
        externalId: invoice.id,
        customerId: idOf(invoice.customer),
        subscriptionExternalId: subscriptionOfInvoice(invoice),
        transactionId,
        amount: toMajorUnits(amount, invoice.currency),
        kind: kindOf(invoice.billing_reason),
        fee: paid ? await feeOf(stripe, transactionId) : null,
        // Tax on a Stripe invoice is the seller's to hand back, not Stripe's.
        tax: null,
        currency: invoice.currency,
        paid,
        invoiceUrl: invoice.hosted_invoice_url ?? null,
        billedAt:
          dateOf(invoice.status_transitions.paid_at) ??
          dateOf(invoice.created) ??
          new Date()
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
