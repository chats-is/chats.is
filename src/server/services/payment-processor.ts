import '@tanstack/react-start/server-only';

import {
  type PaymentKind,
  type PaymentProcessorId,
  type ProcessorPrice
} from '@/types/payment';
import { PublicError } from '@/server/public-error';

/**
 * A payment processor, as the rest of the app sees it.
 *
 * Every processor does the same few things — sell a price, change or cancel
 * a subscription, report what happened by webhook — and says it in its own
 * words. An adapter turns those words into these, so the subscription
 * service holds the rules once and another processor is one more adapter.
 */

/** A subscription as the processor has it now. */
export type ProcessorSubscription = {
  externalId: string;
  customerId: string;
  /** The user and plan the app wrote on it when it was sold or changed. */
  userId: string | null;
  planId: string | null;
  /** The price it is billed at, which names its plan and interval. */
  priceId: string | null;
  /**
   * `active` while it is in effect; `canceled` once it has stopped — by
   * whoever, or because its payment failed (`paymentFailed`). `incomplete`
   * is one not paid for yet, which the app does not keep.
   */
  status: 'incomplete' | 'active' | 'canceled';
  /** Set to stop when what was paid for runs out, rather than renew. */
  cancelAtPeriodEnd: boolean;
  /** Stopped, or stopping, because a renewal could not be paid. */
  paymentFailed: boolean;
  /** Stopped by a pause in the processor, which may resume it. */
  paused?: boolean;
  /** Paid up to here. */
  expiresAt: Date | null;
};

/** One invoice, paid or not. Amounts in the currency's main unit. */
export type ProcessorPayment = {
  externalId: string;
  customerId: string | null;
  subscriptionExternalId: string | null;
  /** The transaction that took the money, which refunds and disputes name. */
  transactionId: string | null;
  amount: number;
  /** What it paid for: the first period, a renewal, or an upgrade. */
  kind: PaymentKind;
  /** What the processor kept as its fee, where it says. */
  fee: number | null;
  /** The tax in `amount` that the processor collected and hands back with a
   *  refund — a processor that sells as the merchant. Null otherwise. */
  tax: number | null;
  currency: string;
  paid: boolean;
  invoiceUrl: string | null;
  billedAt: Date;
};

/**
 * How a subscription is paid for, as the user's Billing shows it: a card's
 * brand, last four digits and expiry, or the kind of method it is — PayPal,
 * say — where it is not a card. Read from the processor when shown.
 */
export type PaymentMethod = {
  /** `card`, `paypal`, … as the processor names it. */
  type: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
};

/** What a webhook asks the app to do, once its signature has been checked. */
export type WebhookAction =
  | {
      kind: 'subscription';
      externalId: string;
      /** The user and plan the webhook itself names, for a processor whose
       *  subscriptions cannot carry them. */
      hints?: { userId: string | null; planId: string | null };
    }
  | { kind: 'payment'; externalId: string }
  | {
      kind: 'refund';
      transactionId: string;
      /** All refunded of the payment so far, in the currency's main unit. */
      refundAmount: number;
    }
  | {
      /** A refund the processor refused: nothing went back. */
      kind: 'refund_failed';
      transactionId: string;
    }
  | { kind: 'dispute'; transactionId: string }
  | { kind: 'ignore' };

export type WebhookEvent = { id: string; type: string; action: WebhookAction };

/** An amount in a currency's minor units in its main unit: 1050 USD is
 *  10.5, 1050 JPY is 1050. Processors count in minor units. */
export function toMajorUnits(amount: number, currency: string): number {
  const digits =
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).resolvedOptions().maximumFractionDigits ?? 2;
  return amount / 10 ** digits;
}

/** A webhook whose signature does not check out; answered 400. */
export class WebhookSignatureError extends Error {}

/**
 * What every processor does, in the same way, so the subscription flow is
 * one whichever processor a plan is sold through.
 */
export interface PaymentProcessor {
  id: PaymentProcessorId;

  /** Read a price as the processor has it. Whether it can sell a plan is
   *  the subscription service's to say. */
  getPrice: (priceId: string) => Promise<ProcessorPrice>;

  /**
   * A page that sells `priceId`; the user is sent to its address. The
   * customer is the one the user already has there, if any; the checkout
   * makes one otherwise.
   */
  createCheckout: (input: {
    customerId: string | null;
    email: string;
    priceId: string;
    userId: string;
    planId: string;
    /** The app's own address, for a processor whose checkout runs on it. */
    origin: string;
    successUrl: string;
    cancelUrl: string;
  }) => Promise<string>;

  /** How the subscription is paid for now, or null when the processor has
   *  none on file. */
  getPaymentMethod: (subscription: {
    externalId: string;
    customerId: string;
  }) => Promise<PaymentMethod | null>;

  /** A hosted page where the user changes how they pay. */
  paymentMethodsUrl: (
    subscription: { externalId: string; customerId: string },
    returnUrl: string
  ) => Promise<string>;

  getSubscription: (externalId: string) => Promise<ProcessorSubscription>;

  /** Move up to a dearer price now, charging the difference. Throws when
   *  the charge fails, and then nothing has changed. */
  changeNow: (
    externalId: string,
    target: { priceId: string; planId: string }
  ) => Promise<void>;

  /** Stop when what was paid for runs out. */
  cancelAtPeriodEnd: (externalId: string) => Promise<void>;

  /** Undo `cancelAtPeriodEnd` while it still runs. */
  resume: (externalId: string) => Promise<void>;

  /** Stop now. Already stopped is not an error. */
  cancelNow: (externalId: string) => Promise<void>;

  /**
   * Refund one payment, all or part: `cents` go back now, and `whole` says
   * it is everything paid, with nothing refunded before. Throws when the
   * processor refuses at once. Whether the money went back is the
   * processor's webhook to say.
   */
  refundPayment: (
    payment: { externalId: string; transactionId: string | null },
    refund: { cents: number; whole: boolean }
  ) => Promise<void>;

  getPayment: (externalId: string) => Promise<ProcessorPayment | null>;

  /** A link to a payment's invoice, made when asked — for a processor whose
   *  invoice links do not last, so none is kept on the payment. */
  invoiceUrl?: (externalId: string) => Promise<string | null>;

  /** The subscription in the processor's own dashboard, for an admin. */
  dashboardUrl: (externalId: string) => Promise<string>;

  /** Check a webhook's signature and say what it asks for. */
  parseWebhook: (payload: string, headers: Headers) => Promise<WebhookEvent>;
}

/**
 * The adapter for a processor. Loaded when first asked for, so a
 * processor's SDK and keys are only touched by code that pays through it.
 */
/**
 * A request to a processor, tried again when it fails for a while — a
 * network error, or the processor's own 5xx — up to three times more, a
 * moment apart. A refusal (a 4xx, or the app's own `PublicError`) is not
 * tried again: it would be refused again.
 */
export async function withRetry<T>(request: () => Promise<T>): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await request();
    } catch (err) {
      if (retry >= 3 || !isTransient(err)) throw err;
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** retry));
    }
  }
}

function isTransient(err: unknown): boolean {
  if (err instanceof PublicError) return false;
  const e = err as { status?: unknown; statusCode?: unknown } | null;
  const status = e?.status ?? e?.statusCode;
  return typeof status !== 'number' || status >= 500;
}

export async function getPaymentProcessor(
  id: PaymentProcessorId
): Promise<PaymentProcessor> {
  switch (id) {
    case 'stripe': {
      const { createStripeProcessor } =
        await import('@/server/services/payment-stripe');
      return createStripeProcessor();
    }
    case 'paddle': {
      const { createPaddleProcessor } =
        await import('@/server/services/payment-paddle');
      return createPaddleProcessor();
    }
    case 'lemonsqueezy': {
      const { createLemonSqueezyProcessor } =
        await import('@/server/services/payment-lemonsqueezy');
      return createLemonSqueezyProcessor();
    }
    default:
      throw new PublicError(`Unknown payment processor ${id as string}.`);
  }
}
