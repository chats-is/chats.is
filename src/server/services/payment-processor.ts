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
   * `active` while it is in effect — also while a renewal that failed is
   * being retried (`paymentFailed`); `canceled` once it has stopped — by
   * whoever, or with its retries used up (`paymentFailed`). `incomplete` is
   * one not paid for yet, which the app does not keep.
   */
  status: 'incomplete' | 'active' | 'canceled';
  /** Set to stop when what was paid for runs out, rather than renew. */
  cancelAtPeriodEnd: boolean;
  /** A renewal could not be paid: still retried while `active`, given up
   *  on once `canceled`. */
  paymentFailed: boolean;
  /** Stopped by a pause in the processor, which may resume it. */
  paused?: boolean;
  /** Paid up to here. */
  expiresAt: Date | null;
};

/** One invoice, paid or not. Amounts as kept (10.5, not 1050). */
export type ProcessorPayment = {
  externalId: string;
  customerId: string | null;
  externalSubscriptionId: string | null;
  /** The user and plan the checkout wrote on it, where the processor
   *  carries them on the invoice, and the price it was billed at: enough to
   *  keep the subscription from the payment alone. */
  userId: string | null;
  planId: string | null;
  priceId: string | null;
  /** Up to when it pays for the subscription, where the processor says. */
  periodEnd: Date | null;
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
  paid: boolean;
  invoiceUrl: string | null;
  billedAt: Date;
};

/** One refund of a payment, as the processor reports it. */
export type ProcessorRefund = {
  /** The refund in the processor: the id `refundPayment` returned for one
   *  sent from here, and the one every event about it names. */
  externalId: string;
  /** This refund's amount. */
  amount: number;
  /** All refunded of the payment so far, where the processor says it. */
  total: number | null;
  status: 'pending' | 'succeeded' | 'failed';
};

/**
 * Where a payment's refunds and disputes stand in the processor now — read
 * to make up for a webhook that never came.
 */
export type ProcessorPaymentState = {
  /** All refunded of it so far, where the processor says it. */
  refunded: number;
  /** A refund of it is still being processed there. */
  refundPending: boolean;
  /** `inquiry` has taken no money; `withdrawn` has; `won` gave it back. */
  dispute: 'none' | 'inquiry' | 'withdrawn' | 'won';
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

/**
 * What a webhook says, once its signature has been checked: the object it
 * is about, as the processor has it. The content is applied as it is.
 */
export type WebhookAction =
  | { kind: 'subscription'; subscription: ProcessorSubscription }
  | { kind: 'payment'; payment: ProcessorPayment }
  | {
      kind: 'refund';
      transactionId: string;
      refund: ProcessorRefund;
      /** The user and plan, where the processor repeats the checkout's
       *  custom data on its refund webhook (Lemon Squeezy). */
      userId?: string | null;
      planId?: string | null;
    }
  | {
      kind: 'dispute';
      transactionId: string;
      /** Whether the money has left: a chargeback, or the processor's own
       *  refund to avoid one. False while it is only an inquiry. */
      withdrawn: boolean;
    }
  | {
      /** A dispute closed in the seller's favour: the money is back. */
      kind: 'dispute_won';
      transactionId: string;
    }
  | { kind: 'ignore' };

export type WebhookEvent = { id: string; type: string; action: WebhookAction };

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

  /**
   * The subscriptions a checkout the user came back from made, for when its
   * webhook has not arrived: by what the checkout's return carries (`ref`),
   * or, where it carries nothing, by the email it was paid under. Only the
   * user's own.
   */
  findSubscriptions: (checkout: {
    ref: string | null;
    userId: string;
    email: string;
  }) => Promise<string[]>;

  /** What moving to `priceId` now would charge today; null
   *  where the processor cannot say beforehand. */
  previewChange: (
    externalId: string,
    target: { priceId: string }
  ) => Promise<number | null>;

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
   * Refund one payment, all or part: `minor` go back now, and `whole` says
   * it is everything paid, with nothing refunded before. Throws when the
   * processor refuses at once. Whether the money went back is the
   * processor's webhook to say, naming the refund by the id returned.
   */
  refundPayment: (
    payment: { externalId: string; transactionId: string | null },
    refund: { minor: number; whole: boolean }
  ) => Promise<{ externalId: string }>;

  getPayment: (externalId: string) => Promise<ProcessorPayment | null>;

  /** A payment's refunds and disputes as the processor has them now. */
  getPaymentState: (payment: {
    externalId: string;
    transactionId: string | null;
  }) => Promise<ProcessorPaymentState>;

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
