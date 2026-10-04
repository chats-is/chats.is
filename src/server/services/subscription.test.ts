import { makeTestDb } from '@/test-utils/pg';
import { eq } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { type BillingInterval, type ProcessorPrice } from '@/types/payment';
import { planCreateSchema } from '@/types/plan';
import * as schema from '@/db/schema';
import { PublicError } from '@/server/public-error';
import {
  WebhookSignatureError,
  type PaymentProcessor,
  type ProcessorPayment,
  type ProcessorSubscription,
  type WebhookAction
} from '@/server/services/payment-processor';

/**
 * Plans, subscriptions, payments and refunds against a real Postgres, with
 * the payment processor stood in by one that keeps its prices,
 * subscriptions and invoices in memory. What the processor reports reaches
 * the app as it does in production: through a webhook. Each test is one
 * rule of the one flow every processor shares.
 */

const h = vi.hoisted(() => ({
  db: undefined as any,
  selling: true,
  // How many days a subscription keeps its plan after a renewal fails.
  graceDays: 3,
  // Set for each test in `beforeEach`; null is `auto`, and no limit.
  refunds: {
    enabled: true,
    refundFee: null as number | null,
    days: 7,
    maxRequests: null as number | null
  },
  processor: undefined as any
}));

vi.mock('@/db', () => ({
  get db() {
    return h.db;
  }
}));
vi.mock('@/server/services/settings', () => ({
  getSubscriptionsEnabled: async () => h.selling,
  getRefundPolicy: async () => h.refunds,
  getSubscriptionGraceDays: async () => h.graceDays
}));
vi.mock('@/server/services/model', () => ({
  getAllModels: async () => [
    { modelId: 'cheap', name: 'Cheap', capability: 'chat' },
    { modelId: 'big', name: 'Big', capability: 'chat' }
  ]
}));
vi.mock('@/lib/env', () => ({ env: {} }));
vi.mock('@/server/services/payment-processor', async importOriginal => ({
  ...(await importOriginal<
    typeof import('@/server/services/payment-processor')
  >()),
  getPaymentProcessor: async () => h.processor
}));

const {
  adminCancelSubscription,
  approveRefundRequest,
  cancelSubscription,
  confirmCheckout,
  getMyRefundRequest,
  getMySubscription,
  getRefundDetails,
  getRefundRequest,
  getSubscriptionDetail,
  handleWebhook,
  listPlansForSale,
  listRefundRequests,
  listSubscriptions,
  lookupProcessorPrice,
  previewUpgrade,
  runScheduledJob,
  refundPayment,
  rejectRefundRequest,
  resubscribe,
  startCheckout,
  submitRefundRequest,
  upgradePlan
} = await import('@/server/services/subscription');
const { listMyPayments, listPayments, listSubscriptionPayments } =
  await import('@/server/services/payment');
const { createPlan, deletePlan, setPlanEnabled, updatePlan } =
  await import('@/server/services/plan');
const { deleteUser } = await import('@/server/services/user');

let client: { close?: () => Promise<void> } | undefined;

beforeAll(async () => {
  const t = await makeTestDb();
  h.db = t.db;
  client = t.client;
});

afterAll(async () => {
  await client?.close?.();
});

// ---------------------------------------------------------------------------
// The stand-in processor
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const inDays = (n: number) => new Date(Date.now() + n * DAY);

/** The processor's prices, as it would report them. */
const PROCESSOR_PRICES: Record<string, ProcessorPrice> = Object.fromEntries(
  (
    [
      ['price_basic_m', 10, 'month'],
      ['price_basic_y', 100, 'year'],
      ['price_pro_m', 20, 'month'],
      ['price_pro_y', 200, 'year'],
      ['price_max_m', 50, 'month'],
      ['price_twin_m', 20, 'month'],
      ['price_yearly_y', 300, 'year'],
      ['price_weekly_w', 3, 'week'],
      ['price_old', 5, 'month']
    ] as const
  ).map(([priceId, amount, interval]) => [
    priceId,
    {
      priceId,
      amount,
      interval,
      active: true,
      metered: false,
      maxQuantity: null
    }
  ])
);

function fakeProcessor() {
  const subs = new Map<string, ProcessorSubscription>();
  const invoices = new Map<string, ProcessorPayment>();
  const prices = structuredClone(PROCESSOR_PRICES);
  let next: WebhookAction | Error = { kind: 'ignore' };

  const processor = {
    id: 'stripe',
    subs,
    invoices,
    prices,
    willSend(action: WebhookAction | Error) {
      next = action;
    },
    getPrice: vi.fn(async (priceId: string) => {
      const price = prices[priceId];
      if (!price) throw new Error(`no price ${priceId}`);
      return price;
    }),
    createCheckout: vi.fn(async () => 'https://pay.example/checkout'),
    paymentMethodsUrl: vi.fn(async () => 'https://pay.example/portal'),
    getSubscription: vi.fn(async (id: string) => {
      const sub = subs.get(id);
      if (!sub) throw new Error(`no subscription ${id}`);
      return { ...sub };
    }),
    changeNow: vi.fn(
      async (id: string, target: { priceId: string; planId: string }) => {
        Object.assign(subs.get(id)!, {
          priceId: target.priceId,
          planId: target.planId,
          cancelAtPeriodEnd: false
        });
      }
    ),
    cancelAtPeriodEnd: vi.fn(async (id: string) => {
      subs.get(id)!.cancelAtPeriodEnd = true;
    }),
    resume: vi.fn(async (id: string) => {
      subs.get(id)!.cancelAtPeriodEnd = false;
    }),
    cancelNow: vi.fn(async (id: string) => {
      const sub = subs.get(id);
      // Canceled, no payment is retried any more.
      if (sub) Object.assign(sub, { status: 'canceled', paymentFailed: false });
    }),
    refundPayment: vi.fn(async () => ({ externalId: 're_1' })),
    findSubscriptions: vi.fn(async () => [...subs.keys()]),
    getRefund: vi.fn(async () => ({
      externalId: 're_1',
      amount: 8,
      total: null,
      status: 'pending' as const
    })),
    previewChange: vi.fn(async () => 7.5),
    dashboardUrl: vi.fn(async (id: string) => `https://pay.example/subs/${id}`),
    getPayment: vi.fn(async (id: string) => invoices.get(id) ?? null),
    parseWebhook: vi.fn(async () => {
      if (next instanceof Error) throw next;
      return { id: 'evt', type: 'event', action: next };
    })
  };
  return processor as unknown as PaymentProcessor & typeof processor;
}

/** Send one webhook, as the processor would. */
async function webhook(action: WebhookAction) {
  h.processor.willSend(action);
  await handleWebhook('stripe', '{}', new Headers());
}

/** The processor says `total` of a payment has gone back in all. */
/** `re_1` is the refund the stand-in processor makes for one sent from
 *  here; any other id is a refund made in the processor itself. */
const refund = (transactionId: string, total: number, externalId = 're_1') =>
  webhook({
    kind: 'refund',
    transactionId,
    refund: { externalId, amount: total, total, status: 'succeeded' }
  });

/** The processor says the refund sent from here failed. */
const refundFailed = (transactionId: string) =>
  webhook({
    kind: 'refund',
    transactionId,
    refund: { externalId: 're_1', amount: 0, total: null, status: 'failed' }
  });

const dispute = (transactionId: string, withdrawn: boolean) =>
  webhook({ kind: 'dispute', transactionId, withdrawn });

const disputeWon = (transactionId: string) =>
  webhook({ kind: 'dispute_won', transactionId });

const EXPIRES = new Date('2030-10-01T00:00:00Z');

/** A subscription in the processor, as checkout would leave it. */
function processorSubscription(
  overrides: Partial<ProcessorSubscription> = {}
): ProcessorSubscription {
  const sub: ProcessorSubscription = {
    externalId: 'sub_1',
    customerId: 'cus_u1',
    userId: 'u1',
    planId: 'basic',
    priceId: 'price_basic_m',
    status: 'active',
    cancelAtPeriodEnd: false,
    paymentFailed: false,
    expiresAt: EXPIRES,
    ...overrides
  };
  h.processor.subs.set(sub.externalId, sub);
  return sub;
}

/** The processor has a subscription as given, and says so. */
async function report(overrides: Partial<ProcessorSubscription> = {}) {
  const sub = processorSubscription({
    ...h.processor.subs.get(overrides.externalId ?? 'sub_1'),
    ...overrides
  });
  await webhook({ kind: 'subscription', subscription: sub });
  return sub;
}

/** An invoice in the processor. */
function invoice(overrides: Partial<ProcessorPayment> = {}) {
  const payment: ProcessorPayment = {
    externalId: 'in_1',
    customerId: 'cus_u1',
    externalSubscriptionId: 'sub_1',
    userId: 'u1',
    planId: 'basic',
    priceId: null,
    periodEnd: null,
    transactionId: 'pi_1',
    amount: 10,
    kind: 'initial',
    fee: 1,
    tax: null,
    paid: true,
    invoiceUrl: 'https://pay.example/in_1',
    billedAt: daysAgo(1),
    ...overrides
  };
  h.processor.invoices.set(payment.externalId, payment);
  return payment;
}

/** The processor took a payment, and says so. */
async function pay(overrides: Partial<ProcessorPayment> = {}) {
  const payment = invoice(overrides);
  await webhook({ kind: 'payment', payment });
  return payment;
}

/** Subscribed and paid for, as a checkout leaves it. */
async function subscribe(
  overrides: Partial<ProcessorSubscription> = {},
  payment: Partial<ProcessorPayment> = {}
) {
  await report(overrides);
  await pay({
    externalSubscriptionId: overrides.externalId ?? 'sub_1',
    userId: overrides.userId ?? 'u1',
    planId: overrides.planId ?? 'basic',
    ...payment
  });
}

const planOf = async (userId: string) =>
  (
    await h.db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      columns: { planId: true }
    })
  )?.planId ?? null;

const planRow = async (id: string) =>
  await h.db.query.plans.findFirst({ where: eq(schema.plans.id, id) });

const rowOf = async (externalId = 'sub_1') =>
  await h.db.query.subscriptions.findFirst({
    where: eq(schema.subscriptions.externalId, externalId)
  });

const paymentOf = async (externalId = 'in_1') =>
  await h.db.query.payments.findFirst({
    where: eq(schema.payments.externalId, externalId)
  });

const listSubscriptionPaymentsOf = async () =>
  await listSubscriptionPayments((await rowOf())!.id);

const requestId = async () =>
  (await h.db.query.refundRequests.findFirst({
    where: eq(schema.refundRequests.status, 'pending_approval')
  }))!.id;

const request = new Request('https://app.example/');
const user = { id: 'u1', email: 'u1@test.com', name: 'U1' };

/** A plan as sold through Stripe, enabled: its price and price ID, billed
 *  every interval. Named as its id unless `extra` names it. */
const plan = (
  id: string,
  interval: BillingInterval,
  [price, priceId]: [number, string],
  extra: Record<string, unknown> = {}
) => ({
  id,
  name: id,
  quotaId: 'q1',
  processor: 'stripe' as const,
  interval,
  price: price.toFixed(2),
  priceId,
  isEnabled: true,
  ...extra
});

beforeEach(async () => {
  h.selling = true;
  h.graceDays = 3;
  h.refunds = { enabled: true, refundFee: 20, days: 7, maxRequests: null };
  h.processor = fakeProcessor();

  await h.db.delete(schema.payments);
  await h.db.delete(schema.refundRequests);
  await h.db.delete(schema.subscriptions);
  await h.db.delete(schema.users);
  await h.db.delete(schema.plans);
  await h.db.delete(schema.tiers);
  await h.db.delete(schema.quotas);

  await h.db.insert(schema.quotas).values([
    { id: 'q1', name: 'q1', isUnlimited: true },
    { id: 'q2', name: 'q2', isUnlimited: true }
  ]);
  await h.db.insert(schema.tiers).values({
    id: 't-cheap',
    name: 'Cheap only',
    modelRestrictionMode: 'allow',
    modelIds: ['cheap']
  });
  await h.db.insert(schema.plans).values([
    plan('basic', 'month', [10, 'price_basic_m'], {
      tierId: 't-cheap',
      displayOrder: 1
    }),
    // Basic sold yearly too: a plan of its own, of the same name.
    plan('basic_y', 'year', [100, 'price_basic_y'], {
      name: 'basic',
      tierId: 't-cheap',
      displayOrder: 2
    }),
    plan('pro', 'month', [20, 'price_pro_m'], { displayOrder: 3 }),
    plan('pro_y', 'year', [200, 'price_pro_y'], {
      name: 'pro',
      displayOrder: 4
    }),
    plan('max', 'month', [50, 'price_max_m'], { displayOrder: 5 }),
    plan('twin', 'month', [20, 'price_twin_m'], { displayOrder: 6 }),
    plan('yearly', 'year', [300, 'price_yearly_y'], { displayOrder: 7 }),
    plan('weekly', 'week', [3, 'price_weekly_w'], { displayOrder: 8 }),
    plan('closed', 'month', [5, 'price_old'], { isEnabled: false })
  ]);
  await h.db.insert(schema.users).values([
    { id: 'u1', name: 'U1', email: 'u1@test.com' },
    { id: 'u2', name: 'U2', email: 'u2@test.com' },
    { id: 'admin', name: 'Admin', email: 'a@test.com', role: 'admin' }
  ]);
});

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

describe('a plan', () => {
  const input = {
    name: 'New',
    quotaId: 'q1',
    displayOrder: 0,
    processor: 'stripe' as const,
    interval: 'week' as const,
    price: 15,
    priceId: 'price_new_w'
  };

  it('needs its processor, interval, price and price ID', () => {
    for (const key of ['processor', 'interval', 'price', 'priceId'] as const) {
      const { [key]: _, ...rest } = input;
      expect(planCreateSchema.safeParse(rest).success).toBe(false);
    }
    expect(planCreateSchema.safeParse(input).success).toBe(true);
  });

  it('is made closed, its price kept to the cent', async () => {
    const { id } = await createPlan(planCreateSchema.parse(input));
    expect(await planRow(id)).toMatchObject({
      processor: 'stripe',
      interval: 'week',
      price: '15.00',
      priceId: 'price_new_w',
      isEnabled: false
    });
  });

  it('is sold under its name once at each interval', async () => {
    await createPlan(planCreateSchema.parse({ ...input, name: 'pro' }));
    await expect(
      createPlan(
        planCreateSchema.parse({
          ...input,
          name: 'pro',
          interval: 'month',
          priceId: 'price_other'
        })
      )
    ).rejects.toThrow('already a monthly plan named pro');
    await expect(updatePlan({ id: 'max', name: 'pro' })).rejects.toThrow(
      'already a monthly plan named pro'
    );
  });

  it('cannot share a price ID with another plan of its processor', async () => {
    await expect(
      createPlan(planCreateSchema.parse({ ...input, priceId: 'price_pro_m' }))
    ).rejects.toThrow('already uses this price ID');
    await expect(
      updatePlan({ id: 'max', priceId: 'price_pro_m' })
    ).rejects.toThrow('already uses this price ID');
    await expect(
      createPlan(
        planCreateSchema.parse({
          ...input,
          processor: 'paddle',
          priceId: 'price_pro_m'
        })
      )
    ).resolves.toBeDefined();
  });

  it('keeps its processor, interval, price and price ID once subscribed to, even when canceled', async () => {
    await subscribe();
    await report({ status: 'canceled' });
    for (const change of [
      { price: 12 },
      { interval: 'year' as const },
      { priceId: 'price_other' },
      { processor: 'paddle' as const }
    ]) {
      await expect(updatePlan({ id: 'basic', ...change })).rejects.toThrow(
        'cannot change'
      );
    }
    await updatePlan({ id: 'basic', quotaId: 'q2', name: 'Basic Plus' });
    expect(await planRow('basic')).toMatchObject({
      quotaId: 'q2',
      name: 'Basic Plus'
    });
  });

  it('cannot be deleted once subscribed to', async () => {
    await subscribe();
    await expect(deletePlan('basic')).rejects.toThrow('Disable it instead');
    await expect(deletePlan('pro')).resolves.toBeUndefined();
  });

  it('opens to new subscriptions', async () => {
    await setPlanEnabled('closed', true);
    expect((await planRow('closed'))?.isEnabled).toBe(true);
  });
});

describe("a processor's price, read for a plan", () => {
  it('gives the amount and interval of a dollar price', async () => {
    expect(await lookupProcessorPrice('stripe', 'price_pro_y')).toEqual({
      price: 200,
      interval: 'year'
    });
    expect(await lookupProcessorPrice('stripe', 'price_weekly_w')).toEqual({
      price: 3,
      interval: 'week'
    });
  });

  it.each([
    ['archived', { active: false }, 'archived'],
    ['billed by usage', { metered: true }, 'billed by usage'],
    [
      'not recurring',
      { interval: null },
      'not billed every day, week, month or year'
    ],
    ['sold by the dozen', { maxQuantity: 12 }, 'maximum quantity to 1']
  ])('is refused %s', async (_, change, message) => {
    Object.assign(h.processor.prices.price_pro_m, change);
    await expect(lookupProcessorPrice('stripe', 'price_pro_m')).rejects.toThrow(
      message
    );
  });
});

// ---------------------------------------------------------------------------
// Subscribing
// ---------------------------------------------------------------------------

describe('subscribing', () => {
  it('lists enabled plans with their price and interval, and no price IDs', async () => {
    const plans = await listPlansForSale();
    expect(plans.map(p => p.id)).toEqual([
      'basic',
      'basic_y',
      'pro',
      'pro_y',
      'max',
      'twin',
      'yearly',
      'weekly'
    ]);
    expect(plans[1]).toMatchObject({
      name: 'basic',
      interval: 'year',
      price: 100
    });
    expect(plans[7]).toMatchObject({ interval: 'week', price: 3 });
    expect(JSON.stringify(plans)).not.toContain('price_');
  });

  it("opens the processor's checkout for the plan's price, with no customer the first time", async () => {
    const { url } = await startCheckout(user, { planId: 'pro_y' }, request);
    expect(url).toBe('https://pay.example/checkout');
    expect(h.processor.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: null,
        email: 'u1@test.com',
        priceId: 'price_pro_y',
        userId: 'u1',
        planId: 'pro_y',
        successUrl: 'https://app.example/?checkout=success&via=stripe',
        cancelUrl: 'https://app.example/?checkout=canceled'
      })
    );
  });

  it('checks out as the customer the user already is, once canceled', async () => {
    await subscribe();
    await report({ status: 'canceled' });
    await startCheckout(user, { planId: 'pro' }, request);
    expect(h.processor.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_u1' })
    );
  });

  it('tells the user plainly when the processor cannot open a checkout', async () => {
    h.processor.createCheckout.mockRejectedValueOnce(
      new Error('checkout.url domain is not approved')
    );
    await expect(
      startCheckout(user, { planId: 'pro' }, request)
    ).rejects.toThrow('Checkout could not be opened. Please try again.');
    // Not set up: the admin's words are not the user's.
    h.processor.createCheckout.mockRejectedValueOnce(
      new PublicError('Paddle is not configured.')
    );
    await expect(
      startCheckout(user, { planId: 'pro' }, request)
    ).rejects.toThrow('Checkout could not be opened. Please try again.');
    h.processor.getPrice.mockRejectedValueOnce(
      new PublicError('Paddle is not configured.')
    );
    await expect(
      startCheckout(user, { planId: 'pro' }, request)
    ).rejects.toThrow('This plan cannot be bought right now.');
  });

  it('sells a weekly plan at its weekly price', async () => {
    await startCheckout(user, { planId: 'weekly' }, request);
    expect(h.processor.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ priceId: 'price_weekly_w', planId: 'weekly' })
    );
  });

  it('refuses a closed plan, and one not there', async () => {
    for (const planId of ['closed', 'gone']) {
      await expect(startCheckout(user, { planId }, request)).rejects.toThrow(
        'not available'
      );
    }
  });

  it("refuses when the processor's price does not match the plan", async () => {
    h.processor.prices.price_pro_m.amount = 25;
    await expect(
      startCheckout(user, { planId: 'pro' }, request)
    ).rejects.toThrow('cannot be bought right now');
    h.processor.prices.price_weekly_w.interval = 'month';
    await expect(
      startCheckout(user, { planId: 'weekly' }, request)
    ).rejects.toThrow('cannot be bought right now');
    expect(h.processor.createCheckout).not.toHaveBeenCalled();
  });

  it('is refused while the feature is off', async () => {
    h.selling = false;
    await expect(
      startCheckout(user, { planId: 'pro' }, request)
    ).rejects.toThrow('not available');
  });

  it('refuses a second subscription while one is active — set to cancel or not — but not once canceled', async () => {
    await subscribe();
    await expect(
      startCheckout(user, { planId: 'pro_y' }, request)
    ).rejects.toThrow('already have a subscription');
    await cancelSubscription('u1');
    await expect(
      startCheckout(user, { planId: 'pro_y' }, request)
    ).rejects.toThrow('already have a subscription');
    await report({ status: 'canceled' });
    await expect(
      startCheckout(user, { planId: 'pro_y' }, request)
    ).resolves.toEqual({ url: 'https://pay.example/checkout' });
  });
});

// ---------------------------------------------------------------------------
// A subscription, from start to cancellation
// ---------------------------------------------------------------------------

describe('a subscription', () => {
  it('is active once the processor has it, and gives its plan', async () => {
    await subscribe();
    expect(await rowOf()).toMatchObject({
      userId: 'u1',
      planId: 'basic',
      processor: 'stripe',
      externalId: 'sub_1',
      customerId: 'cus_u1',
      status: 'active',
      expiresAt: EXPIRES,
      canceledAt: null,
      cancelReason: null
    });
    expect(await planOf('u1')).toBe('basic');
    expect(await getMySubscription('u1')).toMatchObject({
      planName: 'basic',
      interval: 'month',
      price: 10,
      status: 'active',
      canceledAt: null
    });
  });

  it('is not kept until it has been paid for', async () => {
    await report({ status: 'incomplete' });
    expect(await rowOf()).toBeUndefined();
    expect(await planOf('u1')).toBeNull();
  });

  it('stays active when it renews, its expiry moving on once the renewal is paid', async () => {
    await subscribe();
    const next = new Date('2030-11-01T00:00:00Z');
    // The processor counts the next period from the moment it bills it —
    // Stripe about an hour before it charges. Not yet paid for: not yet.
    await report({ expiresAt: next });
    expect(await rowOf()).toMatchObject({
      status: 'active',
      expiresAt: EXPIRES
    });
    await pay({
      externalId: 'in_2',
      transactionId: 'pi_2',
      kind: 'renewal',
      billedAt: EXPIRES
    });
    expect(await rowOf()).toMatchObject({ status: 'active', expiresAt: next });
    // An invoice that does not say the period it paid for (Lemon Squeezy):
    // the processor's subscription is read for its next renewal.
    const later = new Date('2030-12-01T00:00:00Z');
    Object.assign(h.processor.subs.get('sub_1'), { expiresAt: later });
    await pay({
      externalId: 'in_3',
      transactionId: 'pi_3',
      kind: 'renewal',
      billedAt: next
    });
    expect(await rowOf()).toMatchObject({ expiresAt: later });
    expect(await paymentOf('in_3')).toMatchObject({ periodEnd: later });
    // The subscription's own webhook, after, moves nothing.
    await report({ expiresAt: later });
    expect(await rowOf()).toMatchObject({ expiresAt: later });
  });

  it('whose renewal fails after the processor has already counted the next period is still paid only to its expiry', async () => {
    await subscribe();
    const next = new Date('2030-11-01T00:00:00Z');
    await report({ expiresAt: next });
    await pay({
      externalId: 'in_2',
      transactionId: 'pi_2',
      kind: 'renewal',
      paid: false,
      billedAt: EXPIRES
    });
    await report({ paymentFailed: true, expiresAt: next });
    // The grace days run from what was paid for, not from the period the
    // processor is counting.
    expect(await rowOf()).toMatchObject({
      status: 'active',
      expiresAt: EXPIRES
    });
    expect(await getMySubscription('u1')).toMatchObject({
      paymentFailed: true
    });
  });

  it('cancelled by the user stays active until it expires, set to cancel then', async () => {
    await subscribe();
    await cancelSubscription('u1');
    expect(h.processor.cancelAtPeriodEnd).toHaveBeenCalledWith('sub_1');
    expect(await rowOf()).toMatchObject({
      status: 'active',
      canceledAt: EXPIRES,
      cancelReason: 'canceled_by_customer'
    });
    expect(await planOf('u1')).toBe('basic');
    // The processor's webhook about it changes nothing.
    await report();
    expect(await rowOf()).toMatchObject({
      status: 'active',
      canceledAt: EXPIRES,
      cancelReason: 'canceled_by_customer'
    });
  });

  it('cancelled by an admin is the same, with its own reason', async () => {
    await subscribe();
    await adminCancelSubscription((await rowOf())!.id, 'admin');
    expect(await rowOf()).toMatchObject({
      status: 'active',
      canceledAt: EXPIRES,
      cancelReason: 'canceled_by_admin'
    });
  });

  it('cannot be cancelled twice', async () => {
    await subscribe();
    await cancelSubscription('u1');
    await expect(cancelSubscription('u1')).rejects.toThrow('already set');
  });

  it('resubscribed clears the cancellation, nothing charged', async () => {
    await subscribe();
    await cancelSubscription('u1');
    await resubscribe('u1');
    expect(h.processor.resume).toHaveBeenCalledWith('sub_1');
    expect(await rowOf()).toMatchObject({
      status: 'active',
      canceledAt: null,
      cancelReason: null
    });
  });

  it('can only be resubscribed when set to cancel', async () => {
    await subscribe();
    await expect(resubscribe('u1')).rejects.toThrow('set to cancel');
  });

  it('is canceled when it expires set to cancel, keeping when and why', async () => {
    const expired = daysAgo(0.001);
    await subscribe({ expiresAt: expired });
    await cancelSubscription('u1');
    await report({ status: 'canceled' });
    expect(await rowOf()).toMatchObject({
      status: 'canceled',
      canceledAt: expired,
      cancelReason: 'canceled_by_customer'
    });
    expect(await planOf('u1')).toBeNull();
    expect(await getMySubscription('u1')).toBeNull();
  });

  it('set to cancel and stopped in the processor before then is canceled when it really ended, not when it was to', async () => {
    await subscribe();
    await cancelSubscription('u1');
    const before = Date.now();
    await report({ status: 'canceled' });
    const row = (await rowOf())!;
    expect(row).toMatchObject({
      status: 'canceled',
      cancelReason: 'canceled_by_customer'
    });
    expect(row.canceledAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.canceledAt!.getTime()).toBeLessThan(EXPIRES.getTime());
    expect(await planOf('u1')).toBeNull();
  });

  it('whose renewal fails stays active while the processor retries, and keeps its plan for the grace days', async () => {
    await subscribe();
    await pay({
      externalId: 'in_2',
      transactionId: 'pi_2',
      kind: 'renewal',
      paid: false,
      billedAt: new Date()
    });
    // The processor already counts the period it could not charge.
    await report({ paymentFailed: true, expiresAt: inDays(4000) });
    expect(await rowOf()).toMatchObject({
      status: 'active',
      canceledAt: null,
      // What was paid for still ends where it did.
      expiresAt: EXPIRES
    });
    expect(h.processor.cancelNow).not.toHaveBeenCalled();
    expect(await planOf('u1')).toBe('basic');
    // That its renewal failed is what its payments say — the latest is the
    // renewal that failed — and all the user is told: nothing else of their
    // subscription changes, and how long it may stay unpaid is not said.
    const mine = (await getMySubscription('u1'))!;
    expect(mine).toMatchObject({
      paymentFailed: true,
      status: 'active',
      canceledAt: null
    });
    expect(mine).not.toHaveProperty('graceEndsAt');
  });

  it('whose renewal is unpaid cannot be upgraded: no new charge before that one is paid', async () => {
    await subscribe();
    await pay({
      externalId: 'in_2',
      transactionId: 'pi_2',
      kind: 'renewal',
      paid: false,
      billedAt: new Date()
    });
    await report({ paymentFailed: true });
    expect(await getMySubscription('u1')).toMatchObject({ canUpgrade: false });
    await expect(upgradePlan('u1', { planId: 'pro' })).rejects.toThrow(
      'Update your payment method'
    );
    expect(h.processor.changeNow).not.toHaveBeenCalled();
  });

  it('whose renewal is unpaid, cancelled by an admin, is canceled now too, and the console says which those are', async () => {
    await subscribe();
    await pay({
      externalId: 'in_2',
      transactionId: 'pi_2',
      kind: 'renewal',
      paid: false,
      billedAt: new Date()
    });
    await report({ paymentFailed: true });
    const listed = await listSubscriptions({ page: 1, pageSize: 20 });
    expect(listed.rows[0]).toMatchObject({ paymentFailed: true });
    await adminCancelSubscription((await rowOf())!.id, 'admin');
    expect(await rowOf()).toMatchObject({
      status: 'canceled',
      cancelReason: 'canceled_by_admin'
    });
    expect(h.processor.cancelNow).toHaveBeenCalledWith('sub_1');
    expect(await planOf('u1')).toBeNull();
    expect(
      (await listSubscriptions({ page: 1, pageSize: 20 })).rows[0]
    ).toMatchObject({ paymentFailed: false });
  });

  it('whose renewal is unpaid, cancelled by the user, is canceled now — and in the processor, whose retries stop', async () => {
    await subscribe();
    await pay({
      externalId: 'in_2',
      transactionId: 'pi_2',
      kind: 'renewal',
      paid: false,
      billedAt: new Date()
    });
    await report({ paymentFailed: true });
    await cancelSubscription('u1');
    expect(await rowOf()).toMatchObject({
      status: 'canceled',
      cancelReason: 'canceled_by_customer'
    });
    expect(h.processor.cancelNow).toHaveBeenCalledWith('sub_1');
    expect(h.processor.cancelAtPeriodEnd).not.toHaveBeenCalled();
    expect(await planOf('u1')).toBeNull();
    expect(await getMySubscription('u1')).toBeNull();
  });

  it('still unpaid past its grace days is canceled by the next failure reported, and in the processor too — however long that would have retried', async () => {
    await subscribe();
    await report({ paymentFailed: true });
    // Four days past its expiry by now, a day past its three of grace: the
    // processor's next retry fails too.
    await h.db.update(schema.subscriptions).set({ expiresAt: daysAgo(4) });
    await pay({
      externalId: 'in_2',
      transactionId: 'pi_2',
      kind: 'renewal',
      paid: false
    });
    expect(await rowOf()).toMatchObject({
      status: 'canceled',
      cancelReason: 'payment_failed'
    });
    expect(h.processor.cancelNow).toHaveBeenCalledWith('sub_1');
    expect(await planOf('u1')).toBeNull();
    // Free to subscribe again.
    await expect(
      startCheckout(user, { planId: 'basic' }, request)
    ).resolves.toMatchObject({ url: expect.any(String) });
  });

  it('with no grace days set, is canceled when its renewal fails at its expiry', async () => {
    h.graceDays = 0;
    await subscribe({ expiresAt: daysAgo(0.001) });
    await pay({
      externalId: 'in_2',
      transactionId: 'pi_2',
      kind: 'renewal',
      paid: false
    });
    expect(await rowOf()).toMatchObject({
      status: 'canceled',
      cancelReason: 'payment_failed'
    });
    expect(h.processor.cancelNow).toHaveBeenCalledWith('sub_1');
    expect(await planOf('u1')).toBeNull();
  });

  it('whose renewal fails before its expiry keeps what was paid for, whatever the grace days', async () => {
    h.graceDays = 0;
    await subscribe({ expiresAt: inDays(2) });
    await report({ paymentFailed: true });
    expect(await rowOf()).toMatchObject({ status: 'active' });
    expect(h.processor.cancelNow).not.toHaveBeenCalled();
    expect(await planOf('u1')).toBe('basic');
  });

  it('whose failed renewal is paid within the grace days is in order again', async () => {
    await subscribe();
    await pay({
      externalId: 'in_2',
      transactionId: 'pi_2',
      kind: 'renewal',
      paid: false,
      billedAt: EXPIRES
    });
    await report({ paymentFailed: true, expiresAt: inDays(4000) });
    expect(await getMySubscription('u1')).toMatchObject({
      paymentFailed: true
    });
    expect(await rowOf()).toMatchObject({ expiresAt: EXPIRES });
    // The processor's retry goes through within the grace days: its payment
    // webhook says so, and the subscription moves on to the period it paid.
    const next = inDays(4000);
    Object.assign(h.processor.subs.get('sub_1'), {
      paymentFailed: false,
      expiresAt: next
    });
    h.processor.refundPayment.mockClear();
    await pay({
      externalId: 'in_2',
      transactionId: 'pi_2',
      kind: 'renewal',
      billedAt: EXPIRES,
      periodEnd: next
    });
    expect(await rowOf()).toMatchObject({ status: 'active', expiresAt: next });
    expect(await getMySubscription('u1')).toMatchObject({
      paymentFailed: false
    });
    expect(await paymentOf('in_2')).toMatchObject({ status: 'paid' });
    expect(h.processor.refundPayment).not.toHaveBeenCalled();
    expect(await planOf('u1')).toBe('basic');
  });

  it('given up on and canceled by the processor is canceled, as it says', async () => {
    await subscribe();
    await pay({
      externalId: 'in_2',
      transactionId: 'pi_2',
      kind: 'renewal',
      paid: false,
      billedAt: new Date()
    });
    await report({ paymentFailed: true });
    await report({ status: 'canceled', paymentFailed: false });
    expect(await rowOf()).toMatchObject({
      status: 'canceled',
      cancelReason: 'canceled_in_processor'
    });
    expect(h.processor.cancelNow).not.toHaveBeenCalled();
    expect(await planOf('u1')).toBeNull();
  });

  it('left standing unpaid by the processor stays as it is until a failure past the grace days is reported', async () => {
    await subscribe();
    // Stripe's `unpaid`: retries used up, the subscription still there.
    await report({ paymentFailed: true });
    expect(await rowOf()).toMatchObject({ status: 'active' });
    await h.db.update(schema.subscriptions).set({ expiresAt: daysAgo(4) });
    await pay({
      externalId: 'in_2',
      transactionId: 'pi_2',
      kind: 'renewal',
      paid: false
    });
    expect(await rowOf()).toMatchObject({
      status: 'canceled',
      cancelReason: 'payment_failed'
    });
    expect(h.processor.cancelNow).toHaveBeenCalledWith('sub_1');
    expect(await planOf('u1')).toBeNull();
  });

  it('whose cancelling in the processor fails is left as it was and the webhook fails; resent, canceled', async () => {
    await subscribe();
    await h.db.update(schema.subscriptions).set({ expiresAt: daysAgo(4) });
    h.processor.cancelNow.mockRejectedValueOnce(
      Object.assign(new Error('refused'), { status: 400 })
    );
    const failure = () =>
      pay({
        externalId: 'in_2',
        transactionId: 'pi_2',
        kind: 'renewal',
        paid: false
      });
    await expect(failure()).rejects.toThrow('refused');
    expect(await rowOf()).toMatchObject({ status: 'active' });
    expect(await paymentOf('in_2')).toMatchObject({ status: 'failed' });
    // Sent again: canceled, and in the processor.
    await failure();
    expect(await rowOf()).toMatchObject({
      status: 'canceled',
      cancelReason: 'payment_failed'
    });
    expect(h.processor.cancelNow).toHaveBeenCalledTimes(2);
  });

  it('set to cancel in the processor is set to cancel here, cancelled there', async () => {
    await subscribe();
    await report({ cancelAtPeriodEnd: true });
    expect(await rowOf()).toMatchObject({
      status: 'active',
      canceledAt: EXPIRES,
      cancelReason: 'canceled_in_processor'
    });
    await report({ cancelAtPeriodEnd: false });
    expect(await rowOf()).toMatchObject({ canceledAt: null });
  });

  it('cancelled at once in the processor is canceled now, cancelled there', async () => {
    await subscribe();
    await report({ status: 'canceled' });
    expect(await rowOf()).toMatchObject({
      status: 'canceled',
      cancelReason: 'canceled_in_processor'
    });
  });

  it('paused in the processor is canceled, and in effect again once resumed there', async () => {
    await subscribe();
    await report({ status: 'canceled', paused: true });
    expect(await rowOf()).toMatchObject({
      status: 'canceled',
      cancelReason: 'paused_in_processor'
    });
    expect(await planOf('u1')).toBeNull();
    await report({ status: 'active', paused: false });
    expect(await rowOf()).toMatchObject({
      status: 'active',
      canceledAt: null,
      cancelReason: null
    });
    expect(await planOf('u1')).toBe('basic');
  });

  it('stays canceled whatever the processor says after', async () => {
    await subscribe();
    await report({ status: 'canceled' });
    await report({ status: 'active' });
    expect(await rowOf()).toMatchObject({ status: 'canceled' });
    expect(await planOf('u1')).toBeNull();
  });

  it('bought beside another is a duplicate: canceled, cancelled in the processor, its payment refunded in full', async () => {
    await subscribe();
    await subscribe(
      { externalId: 'sub_2' },
      { externalId: 'in_2', transactionId: 'pi_2' }
    );
    expect(await rowOf('sub_2')).toMatchObject({
      status: 'canceled',
      cancelReason: 'duplicate'
    });
    expect(h.processor.cancelNow).toHaveBeenCalledWith('sub_2');
    // In full, whatever the refund fee (20% here), by no admin.
    expect(h.processor.refundPayment).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'in_2' }),
      { minor: 1000, whole: true }
    );
    expect(await paymentOf('in_2')).toMatchObject({
      status: 'refund_pending',
      refundAmount: '10.00',
      refundFee: '0',
      refundBy: null
    });
    expect(await rowOf('sub_1')).toMatchObject({ status: 'active' });
    expect(await planOf('u1')).toBe('basic');
  });

  it('changes nothing when the processor refuses a change', async () => {
    await subscribe();
    h.processor.cancelAtPeriodEnd.mockRejectedValueOnce(new Error('down'));
    await expect(cancelSubscription('u1')).rejects.toThrow('down');
    expect(await rowOf()).toMatchObject({ canceledAt: null });
  });
});

describe("the user's plan", () => {
  it('is the plan the processor bills for, at its interval', async () => {
    await subscribe({ priceId: 'price_pro_y', planId: 'pro_y' });
    expect(await rowOf()).toMatchObject({ planId: 'pro_y' });
    expect(await planOf('u1')).toBe('pro_y');
    expect(await getMySubscription('u1')).toMatchObject({
      planName: 'pro',
      interval: 'year',
      price: 200
    });
  });

  it('is billed weekly on a weekly plan', async () => {
    await subscribe(
      { priceId: 'price_weekly_w', planId: 'weekly' },
      { planId: 'weekly', amount: 3 }
    );
    expect(await getMySubscription('u1')).toMatchObject({
      planId: 'weekly',
      interval: 'week',
      price: 3
    });
  });

  it('keeps renewing on a plan that has since been closed', async () => {
    await subscribe();
    await setPlanEnabled('basic', false);
    await report({ expiresAt: new Date('2030-11-01T00:00:00Z') });
    expect(await planOf('u1')).toBe('basic');
  });

  it("is checked against what the webhook names: a missing user or plan, an unknown user, or a price that is not the plan's fails the webhook", async () => {
    await expect(report({ userId: null })).rejects.toThrow('names no user');
    await expect(report({ userId: 'nobody' })).rejects.toThrow(
      'no user nobody'
    );
    await expect(report({ userId: 'u1', planId: 'gone' })).rejects.toThrow(
      'no plan gone'
    );
    await expect(
      report({ planId: 'basic', priceId: 'price_pro_m' })
    ).rejects.toThrow("is not plan basic's");
    await expect(report({ planId: 'basic', priceId: null })).rejects.toThrow(
      'names no price'
    );
    expect(await rowOf()).toBeUndefined();
  });

  it('is never kept without its price, new or already kept', async () => {
    await subscribe();
    await expect(
      report({ priceId: null, cancelAtPeriodEnd: true })
    ).rejects.toThrow('names no price');
    expect(await rowOf()).toMatchObject({ status: 'active', canceledAt: null });
  });
});

describe('upgrading', () => {
  it('moves up to a dearer plan at the same interval, now', async () => {
    await subscribe();
    await upgradePlan('u1', { planId: 'pro' });
    expect(h.processor.changeNow).toHaveBeenCalledWith('sub_1', {
      priceId: 'price_pro_m',
      planId: 'pro'
    });
    expect(await rowOf()).toMatchObject({ status: 'active', planId: 'pro' });
    expect(await planOf('u1')).toBe('pro');
  });

  it('clears a cancellation waiting', async () => {
    await subscribe();
    await cancelSubscription('u1');
    await upgradePlan('u1', { planId: 'pro' });
    expect(await rowOf()).toMatchObject({
      planId: 'pro',
      canceledAt: null,
      cancelReason: null
    });
  });

  it('moves up only at the interval the subscription is billed at', async () => {
    await subscribe(
      { priceId: 'price_basic_y', planId: 'basic_y' },
      { planId: 'basic_y', amount: 100 }
    );
    await expect(upgradePlan('u1', { planId: 'pro' })).rejects.toThrow(
      'cannot be switched to in place'
    );
    await upgradePlan('u1', { planId: 'pro_y' });
    expect(h.processor.changeNow).toHaveBeenCalledWith('sub_1', {
      priceId: 'price_pro_y',
      planId: 'pro_y'
    });
  });

  it('refuses a plan that costs the same or less, or is billed at another interval', async () => {
    await subscribe({ priceId: 'price_pro_m', planId: 'pro' });
    for (const planId of ['twin', 'basic', 'yearly', 'weekly']) {
      await expect(upgradePlan('u1', { planId })).rejects.toThrow(
        'cannot be switched to in place'
      );
    }
  });

  it('changes nothing when the charge fails', async () => {
    await subscribe();
    h.processor.changeNow.mockRejectedValueOnce(new Error('declined'));
    await expect(upgradePlan('u1', { planId: 'pro' })).rejects.toThrow(
      'declined'
    );
    expect(await rowOf()).toMatchObject({ planId: 'basic' });
  });

  it('is refused while the feature is off', async () => {
    await subscribe();
    h.selling = false;
    await expect(upgradePlan('u1', { planId: 'pro' })).rejects.toThrow(
      'not available'
    );
  });
});

describe('a webhook', () => {
  it('with a bad signature is refused', async () => {
    h.processor.willSend(new WebhookSignatureError('bad'));
    await expect(
      handleWebhook('stripe', '{}', new Headers())
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it('sent twice changes nothing the second time', async () => {
    await subscribe();
    await pay();
    await report();
    expect(await h.db.query.subscriptions.findMany()).toHaveLength(1);
    expect(await h.db.query.payments.findMany()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

describe('a payment', () => {
  it('is kept against its subscription and plan, with the email it was paid under', async () => {
    await subscribe();
    expect(await paymentOf()).toMatchObject({
      userId: 'u1',
      userEmail: 'u1@test.com',
      subscriptionId: (await rowOf())!.id,
      planId: 'basic',
      processor: 'stripe',
      kind: 'initial',
      externalId: 'in_1',
      transactionId: 'pi_1',
      amount: '10.00',
      refundAmount: '0.00',
      fee: '1.00',
      status: 'paid',
      invoiceUrl: 'https://pay.example/in_1',
      refundBy: null,
      refundRequestId: null
    });
  });

  it('reported before its subscription is kept for its user and plan, and attached once the subscription arrives', async () => {
    await pay();
    expect(await rowOf()).toBeUndefined();
    expect(await paymentOf()).toMatchObject({
      status: 'paid',
      userId: 'u1',
      planId: 'basic',
      subscriptionId: null
    });
    await report();
    expect(await paymentOf()).toMatchObject({
      subscriptionId: (await rowOf())!.id
    });
    expect(await listSubscriptionPaymentsOf()).toHaveLength(1);
  });

  it('that failed is kept failed; its subscription goes on, saying so, until the processor gives up', async () => {
    await subscribe();
    await pay({ externalId: 'in_2', kind: 'renewal', paid: false });
    expect(await paymentOf('in_2')).toMatchObject({ status: 'failed' });
    expect(await rowOf()).toMatchObject({ status: 'active' });
    expect(await getMySubscription('u1')).toMatchObject({
      paymentFailed: true
    });
    await report({ status: 'canceled' });
    expect(await rowOf()).toMatchObject({ status: 'canceled' });
  });

  it('of an upgrade is on the plan its price names, even when it arrives first', async () => {
    await subscribe();
    await pay({
      externalId: 'in_up',
      kind: 'upgrade',
      transactionId: 'pi_up',
      planId: 'pro',
      priceId: 'price_pro_m'
    });
    expect(await paymentOf('in_up')).toMatchObject({
      planId: 'pro',
      kind: 'upgrade'
    });
  });

  it('disputed with the money taken back is kept so, and its subscription is canceled now, here and in the processor', async () => {
    await subscribe();
    await dispute('pi_1', true);
    expect(await paymentOf()).toMatchObject({ status: 'disputed' });
    expect(await rowOf()).toMatchObject({
      status: 'canceled',
      cancelReason: 'payment_disputed'
    });
    expect(await planOf('u1')).toBeNull();
    expect(h.processor.cancelNow).toHaveBeenCalledWith('sub_1');
  });

  it('under inquiry is only marked: the money has not left, and the subscription stays', async () => {
    await subscribe();
    await dispute('pi_1', false);
    expect(await paymentOf()).toMatchObject({ status: 'disputed' });
    expect(await rowOf()).toMatchObject({ status: 'active', canceledAt: null });
    expect(await planOf('u1')).toBe('basic');
    // Closed without a chargeback: paid again.
    await disputeWon('pi_1');
    expect(await paymentOf()).toMatchObject({ status: 'paid' });
    expect(await rowOf()).toMatchObject({ status: 'active', canceledAt: null });
  });

  it('whose dispute is won is paid again; the subscription stays canceled, to be bought anew', async () => {
    await subscribe();
    await dispute('pi_1', true);
    await disputeWon('pi_1');
    expect(await paymentOf()).toMatchObject({ status: 'paid' });
    expect(await rowOf()).toMatchObject({
      status: 'canceled',
      cancelReason: 'payment_disputed'
    });
    expect(await planOf('u1')).toBeNull();
    await expect(
      startCheckout(user, { planId: 'basic' }, request)
    ).resolves.toMatchObject({ url: expect.any(String) });
  });

  it('reported again, by a retried webhook, keeps what a refund made of it', async () => {
    await subscribe();
    const id = (await paymentOf())!.id;
    await refundPayment({ paymentId: id, cancelSubscription: false }, 'admin');
    await pay();
    expect(await paymentOf()).toMatchObject({
      status: 'refund_pending',
      refundAmount: '8.00'
    });
    await refund('pi_1', 8);
    await pay();
    expect(await paymentOf()).toMatchObject({
      status: 'refunded',
      refundAmount: '8.00'
    });
  });

  it('reported again, by a retried webhook, stays disputed', async () => {
    await subscribe();
    await dispute('pi_1', false);
    await pay();
    expect(await paymentOf()).toMatchObject({ status: 'disputed' });
  });

  it("is the user's own to see, newest first", async () => {
    await subscribe();
    await pay({ externalId: 'in_2', kind: 'renewal', billedAt: new Date() });
    const mine = await listMyPayments('u1');
    expect(mine.map(p => p.kind)).toEqual(['renewal', 'initial']);
    expect(await listMyPayments('u2')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

describe('from a payment, an admin', () => {
  it('refunds all that is left; the subscription is held until the money is back, then canceled now: Refunded', async () => {
    await subscribe();
    const payment = (await paymentOf())!;
    await refundPayment(
      { paymentId: payment.id, cancelSubscription: true },
      'admin'
    );
    expect(h.processor.refundPayment).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'in_1', transactionId: 'pi_1' }),
      { minor: 800, whole: false }
    );
    // What was sent is kept from the start, waiting for the processor, and
    // the refund fee it was reckoned by.
    expect(await paymentOf()).toMatchObject({
      status: 'refund_pending',
      refundAmount: '8.00',
      refundBy: 'admin',
      refundRequestId: null,
      refundFee: '20',
      refundAt: expect.any(Date),
      refundCancelSubscription: true
    });
    // Nothing is taken from the user yet: it only stops renewing.
    expect(await rowOf()).toMatchObject({
      status: 'active',
      canceledAt: EXPIRES,
      cancelReason: 'refunded'
    });
    expect(h.processor.cancelNow).not.toHaveBeenCalled();
    expect(await planOf('u1')).toBe('basic');

    // The processor confirms: canceled now, as the admin chose.
    await refund('pi_1', 8);
    expect(await rowOf()).toMatchObject({
      status: 'canceled',
      cancelReason: 'refunded'
    });
    expect(h.processor.cancelNow).toHaveBeenCalledWith('sub_1');
    expect(await planOf('u1')).toBeNull();
    expect(await paymentOf()).toMatchObject({
      status: 'refunded',
      refundCancelSubscription: null
    });
  });

  it('otherwise cancels the subscription when it expires, usable until then: Refunded', async () => {
    await subscribe();
    await refundPayment(
      { paymentId: (await paymentOf())!.id, cancelSubscription: false },
      'admin'
    );
    expect(await paymentOf()).toMatchObject({ status: 'refund_pending' });
    // Its row shows what was sent, waiting for the processor.
    const [row] = await listSubscriptionPaymentsOf();
    expect(row).toMatchObject({ refundAmount: '8.00', leftToRefund: 0 });
    expect(await rowOf()).toMatchObject({
      status: 'active',
      canceledAt: EXPIRES,
      cancelReason: 'refunded'
    });
    expect(h.processor.cancelAtPeriodEnd).toHaveBeenCalledWith('sub_1');
    await refund('pi_1', 8);
    expect(await rowOf()).toMatchObject({
      status: 'active',
      canceledAt: EXPIRES,
      cancelReason: 'refunded'
    });
    expect(h.processor.cancelNow).not.toHaveBeenCalled();
    expect(await planOf('u1')).not.toBeNull();
  });

  it('of a subscription the user had set to cancel leaves their cancellation as it is — and, the money back, no longer theirs to resume', async () => {
    await subscribe();
    await cancelSubscription('u1');
    await refundPayment(
      { paymentId: (await paymentOf())!.id, cancelSubscription: false },
      'admin'
    );
    await refund('pi_1', 8);
    expect(await rowOf()).toMatchObject({
      status: 'active',
      canceledAt: EXPIRES,
      cancelReason: 'canceled_by_customer',
      canceledBy: 'u1'
    });
    expect(await getMySubscription('u1')).toMatchObject({
      canResume: false,
      canUpgrade: false
    });
    await expect(resubscribe('u1')).rejects.toThrow('cannot be resumed');
  });

  it('puts the subscription back when the refund fails: it renews again', async () => {
    await subscribe();
    await refundPayment(
      { paymentId: (await paymentOf())!.id, cancelSubscription: true },
      'admin'
    );
    await refundFailed('pi_1');
    expect(await paymentOf()).toMatchObject({
      status: 'paid',
      refundAmount: '0.00',
      refundCancelSubscription: null
    });
    expect(await rowOf()).toMatchObject({
      status: 'active',
      canceledAt: null,
      cancelReason: null
    });
    expect(h.processor.resume).toHaveBeenCalledWith('sub_1');
    expect(await planOf('u1')).toBe('basic');
  });

  it('reported gone back and failed after: one left to expire renews again', async () => {
    await subscribe();
    await refundPayment(
      { paymentId: (await paymentOf())!.id, cancelSubscription: false },
      'admin'
    );
    await refund('pi_1', 8);
    expect(await rowOf()).toMatchObject({ cancelReason: 'refunded' });
    await refundFailed('pi_1');
    expect(await paymentOf()).toMatchObject({ status: 'paid' });
    expect(await rowOf()).toMatchObject({
      status: 'active',
      canceledAt: null,
      cancelReason: null
    });
    expect(h.processor.resume).toHaveBeenCalledWith('sub_1');
  });

  it('reported gone back and failed after: one the user had set to cancel is theirs again, still set to cancel', async () => {
    await subscribe();
    await cancelSubscription('u1');
    await refundPayment(
      { paymentId: (await paymentOf())!.id, cancelSubscription: false },
      'admin'
    );
    await refund('pi_1', 8);
    await refundFailed('pi_1');
    expect(await rowOf()).toMatchObject({
      status: 'active',
      canceledAt: EXPIRES,
      cancelReason: 'canceled_by_customer',
      canceledBy: 'u1'
    });
    expect(h.processor.resume).not.toHaveBeenCalled();
    expect(await getMySubscription('u1')).toMatchObject({ canResume: true });
  });

  it('whose cancelling fails after the money is back is done when the webhook is sent again', async () => {
    await subscribe();
    await refundPayment(
      { paymentId: (await paymentOf())!.id, cancelSubscription: true },
      'admin'
    );
    h.processor.cancelNow.mockRejectedValueOnce(
      Object.assign(new Error('refused'), { status: 400 })
    );
    const confirm = () => refund('pi_1', 8);
    await expect(confirm()).rejects.toThrow('refused');
    expect(await rowOf()).toMatchObject({ status: 'active' });
    await confirm();
    expect(await rowOf()).toMatchObject({
      status: 'canceled',
      cancelReason: 'refunded'
    });
    expect(await planOf('u1')).toBeNull();
  });

  it('made in the processor itself ends the subscription too: all of it now, part of it when it expires', async () => {
    await subscribe();
    await refund('pi_1', 10);
    expect(await rowOf()).toMatchObject({
      status: 'canceled',
      cancelReason: 'refunded'
    });
    expect(await planOf('u1')).toBeNull();

    await subscribe(
      { externalId: 'sub_2', customerId: 'cus_u2', userId: 'u2' },
      { externalId: 'in_2', transactionId: 'pi_2', userId: 'u2' }
    );
    await refund('pi_2', 3);
    expect(await rowOf('sub_2')).toMatchObject({
      status: 'active',
      canceledAt: EXPIRES,
      cancelReason: 'refunded'
    });
    expect(h.processor.cancelAtPeriodEnd).toHaveBeenCalledWith('sub_2');
    expect(await planOf('u2')).toBe('basic');
  });

  it('refunds what the refund fee leaves: once that has gone back, nothing is left', async () => {
    await subscribe();
    const id = (await paymentOf())!.id;
    await refundPayment({ paymentId: id, cancelSubscription: false }, 'admin');
    await refund('pi_1', 8);
    expect(await paymentOf()).toMatchObject({
      status: 'refunded',
      refundAmount: '8.00'
    });
    expect(await getRefundDetails(id)).toMatchObject({
      payment: { left: 0 }
    });
    const [row] = await listSubscriptionPaymentsOf();
    expect(row.leftToRefund).toBe(0);
    await expect(
      refundPayment({ paymentId: id, cancelSubscription: false }, 'admin')
    ).rejects.toThrow('cannot be refunded');
  });

  it("on auto, leaves the processor's fee", async () => {
    h.refunds.refundFee = null;
    await subscribe();
    const id = (await paymentOf())!.id;
    expect(await getRefundDetails(id)).toMatchObject({
      payment: { left: 9 }
    });
    await refundPayment({ paymentId: id, cancelSubscription: true }, 'admin');
    expect(h.processor.refundPayment).toHaveBeenCalledWith(expect.anything(), {
      minor: 900,
      whole: false
    });
    expect(await paymentOf()).toMatchObject({ refundFee: 'auto' });
  });

  it('cannot refund while a refund is pending, or a failed payment', async () => {
    await subscribe();
    const id = (await paymentOf())!.id;
    await refundPayment({ paymentId: id, cancelSubscription: false }, 'admin');
    await expect(
      refundPayment({ paymentId: id, cancelSubscription: false }, 'admin')
    ).rejects.toThrow();

    await pay({ externalId: 'in_f', transactionId: 'pi_f', paid: false });
    await expect(
      refundPayment(
        { paymentId: (await paymentOf('in_f'))!.id, cancelSubscription: false },
        'admin'
      )
    ).rejects.toThrow();
  });

  it('leaves the payment and the subscription as they were when the processor refuses the refund', async () => {
    await subscribe();
    h.processor.refundPayment.mockRejectedValueOnce(new Error('refused'));
    await expect(
      refundPayment(
        { paymentId: (await paymentOf())!.id, cancelSubscription: true },
        'admin'
      )
    ).rejects.toThrow('refused');
    expect(await paymentOf()).toMatchObject({
      status: 'paid',
      refundAmount: '0.00',
      refundBy: null,
      refundFee: null,
      refundAt: null
    });
    expect(await rowOf()).toMatchObject({ status: 'active', canceledAt: null });
  });

  it('sees what was paid, the fee, and what is left to refund', async () => {
    await subscribe();
    expect(await getRefundDetails((await paymentOf())!.id)).toMatchObject({
      payment: {
        planName: 'basic',
        kind: 'initial',
        status: 'paid',
        paid: 10,
        paymentFee: 1,
        refunded: 0,
        left: 8
      },
      refundFee: 20,
      subscription: { planName: 'basic', status: 'active' }
    });
  });
});

describe('a refund, as the processor confirms it', () => {
  const refundPart = async () => {
    await subscribe();
    await refundPayment(
      {
        paymentId: (await paymentOf())!.id,
        cancelSubscription: false
      },
      'admin'
    );
  };

  it('sent from here: refunded, still naming who sent it', async () => {
    await refundPart();
    await refund('pi_1', 3);
    expect(await paymentOf()).toMatchObject({
      status: 'refunded',
      refundAmount: '3.00',
      refundBy: 'admin'
    });
  });

  it('of all of it: refunded', async () => {
    await refundPart();
    await refund('pi_1', 10);
    expect(await paymentOf()).toMatchObject({
      status: 'refunded',
      refundAmount: '10.00'
    });
  });

  it('confirmed twice changes nothing the second time', async () => {
    await refundPart();
    const confirm = () => refund('pi_1', 3);
    await confirm();
    await confirm();
    expect(await paymentOf()).toMatchObject({
      status: 'refunded',
      refundAmount: '3.00',
      refundBy: 'admin'
    });
  });

  it('refused puts the payment back as it was, still naming who sent it', async () => {
    await refundPart();
    await refundFailed('pi_1');
    expect(await paymentOf()).toMatchObject({
      status: 'paid',
      refundAmount: '0.00',
      refundBy: 'admin'
    });
  });

  it('of a payment not kept fails the webhook', async () => {
    await report();
    await expect(refund('pi_1', 3)).rejects.toThrow('not kept');
    await expect(dispute('pi_1', true)).rejects.toThrow('not kept');
    expect(await rowOf()).toMatchObject({ status: 'active' });
  });

  it('reported refunded and then failed is back to paid, nothing refunded', async () => {
    await refundPart();
    await refund('pi_1', 8);
    await refundFailed('pi_1');
    expect(await paymentOf()).toMatchObject({
      status: 'paid',
      refundAmount: '0.00'
    });
  });

  it('made in the processor itself is kept, and clears who refunded before', async () => {
    await refundPart();
    await refund('pi_1', 3);
    await refund('pi_1', 5, 're_2');
    expect(await paymentOf()).toMatchObject({
      status: 'refunded',
      refundAmount: '5.00',
      refundBy: null,
      refundRequestId: null,
      refundFee: null,
      refundAt: expect.any(Date)
    });
  });
});

describe('a duplicate subscription', () => {
  /** A refusal: not tried again. */
  const refused = (message: string) =>
    Object.assign(new Error(message), { status: 400 });
  const duplicate = () => rowOf('sub_2');
  const reportDuplicate = () => report({ externalId: 'sub_2' });
  const payDuplicate = () =>
    pay({
      externalId: 'in_2',
      transactionId: 'pi_2',
      externalSubscriptionId: 'sub_2'
    });

  it('is kept as a duplicate when its payment is reported first, and that payment goes back', async () => {
    await subscribe();
    await payDuplicate();
    expect(await paymentOf('in_2')).toMatchObject({ subscriptionId: null });
    await reportDuplicate();
    expect(await duplicate()).toMatchObject({ cancelReason: 'duplicate' });
    expect(await paymentOf('in_2')).toMatchObject({
      status: 'refund_pending'
    });
    expect(await planOf('u1')).toBe('basic');
  });

  it('tries a request that fails for a while again, and is done', async () => {
    await subscribe();
    h.processor.cancelNow.mockRejectedValueOnce(new Error('network'));
    await reportDuplicate();
    expect(h.processor.cancelNow).toHaveBeenCalledTimes(2);
    expect(await duplicate()).toMatchObject({ cancelReason: 'duplicate' });
  });

  it('not cancelled in the processor: kept canceled, and the webhook fails; resent, cancelled there', async () => {
    await subscribe();
    h.processor.cancelNow.mockRejectedValueOnce(refused('refused'));
    await expect(reportDuplicate()).rejects.toThrow('refused');
    expect(await duplicate()).toMatchObject({
      status: 'canceled',
      cancelReason: 'duplicate'
    });
    // Its payment, meanwhile, goes back.
    await payDuplicate();
    expect(await paymentOf('in_2')).toMatchObject({ status: 'refund_pending' });
    // Sent again: still running in the processor, it is cancelled there.
    await reportDuplicate();
    expect(h.processor.subs.get('sub_2')!.status).toBe('canceled');
    expect(h.processor.refundPayment).toHaveBeenCalledTimes(1);
  });

  it('whose refund the processor refuses is left paid, for an admin to refund in full', async () => {
    await subscribe();
    await reportDuplicate();
    h.processor.refundPayment.mockRejectedValueOnce(refused('declined'));
    await payDuplicate();
    const payment = (await paymentOf('in_2'))!;
    expect(payment).toMatchObject({ status: 'paid' });
    expect(await getRefundDetails(payment.id)).toMatchObject({
      payment: { left: 10, duplicate: true }
    });
    await refundPayment(
      { paymentId: payment.id, cancelSubscription: true },
      'admin'
    );
    expect(await paymentOf('in_2')).toMatchObject({
      status: 'refund_pending',
      refundAmount: '10.00',
      refundBy: 'admin'
    });
  });

  it('whose refund the processor fails later is paid again, for an admin to refund in full', async () => {
    await subscribe();
    await reportDuplicate();
    await payDuplicate();
    await refundFailed('pi_2');
    expect(await paymentOf('in_2')).toMatchObject({ status: 'paid' });
    expect(await duplicate()).toMatchObject({ cancelReason: 'duplicate' });
    const payment = (await paymentOf('in_2'))!;
    await refundPayment(
      { paymentId: payment.id, cancelSubscription: true },
      'admin'
    );
    expect(await paymentOf('in_2')).toMatchObject({
      status: 'refund_pending',
      refundAmount: '10.00'
    });
  });

  it('confirmed refunded by the processor', async () => {
    await subscribe();
    await reportDuplicate();
    await payDuplicate();
    await refund('pi_2', 10);
    expect(await paymentOf('in_2')).toMatchObject({
      status: 'refunded',
      refundAmount: '10.00'
    });
  });
});

describe('a refund request', () => {
  it('shows the rules and an estimate: the refund fee off each payment in the window', async () => {
    h.refunds.refundFee = 10;
    h.refunds.maxRequests = 2;
    await subscribe({}, { billedAt: daysAgo(3) });
    await pay({
      externalId: 'in_up',
      transactionId: 'pi_up',
      kind: 'upgrade',
      amount: 20,
      billedAt: daysAgo(1)
    });
    const offer = await getMyRefundRequest('u1');
    expect(offer).toMatchObject({
      canRequest: true,
      unavailable: null,
      latest: null,
      rules: {
        enabled: true,
        days: 7,
        refundFee: 10,
        requestsLeft: 2,
        planName: 'basic'
      },
      estimate: 27
    });
    expect(offer!.payments.map(p => [p.kind, p.estimate])).toEqual([
      ['initial', 9],
      ['upgrade', 18]
    ]);
  });

  it("estimates all but the processor's fee on auto", async () => {
    h.refunds.refundFee = null;
    await subscribe();
    expect((await getMyRefundRequest('u1'))!.estimate).toBe(9);
  });

  it('cannot be made while refunds are off, or with no payment in the window', async () => {
    await subscribe({}, { billedAt: daysAgo(8) });
    expect(await getMyRefundRequest('u1')).toMatchObject({
      canRequest: false,
      unavailable: 'Refunds can be requested within 7 days of a payment.'
    });
    h.refunds.enabled = false;
    expect(await getMyRefundRequest('u1')).toMatchObject({
      canRequest: false,
      unavailable: 'Refunds are not available.'
    });
    await expect(submitRefundRequest('u1', {})).rejects.toThrow(
      'not available'
    );
  });

  it('cannot be made once the subscription is past its expiry, even with a payment still in the window', async () => {
    // Upgraded days before its expiry, and its renewal then failed.
    await subscribe({ expiresAt: daysAgo(1) }, { billedAt: daysAgo(3) });
    expect(await getMyRefundRequest('u1')).toMatchObject({
      canRequest: false,
      unavailable:
        'Refunds can be requested only before your subscription expires.'
    });
    await expect(submitRefundRequest('u1', {})).rejects.toThrow(
      'before your subscription expires'
    );
  });

  it('is made with no amount, pending approval, and leaves the subscription as it is', async () => {
    await subscribe();
    await submitRefundRequest('u1', { reason: 'Not for me' });
    expect(await h.db.query.refundRequests.findFirst()).toMatchObject({
      userId: 'u1',
      subscriptionId: (await rowOf())!.id,
      status: 'pending_approval',
      reason: 'Not for me',
      rejectionReason: null
    });
    expect(await rowOf()).toMatchObject({ status: 'active', canceledAt: null });
    expect(await paymentOf()).toMatchObject({ status: 'paid' });
    expect(await getMyRefundRequest('u1')).toMatchObject({
      canRequest: false,
      unavailable: 'Your refund request is being reviewed.',
      latest: { status: 'pending_approval' }
    });
  });

  it('cannot be made twice while one is pending approval', async () => {
    await subscribe();
    await submitRefundRequest('u1', {});
    await expect(submitRefundRequest('u1', {})).rejects.toThrow(
      'being reviewed'
    );
  });

  it('shows the admin the payments it covers as they were when asked', async () => {
    await subscribe({}, { billedAt: daysAgo(6) });
    await submitRefundRequest('u1', {});
    // Days later, past the window: the request still covers them.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(inDays(5));
    try {
      const detail = await getRefundRequest(await requestId());
      expect(detail).toMatchObject({
        status: 'pending_approval',
        user: { id: 'u1' },
        subscription: { status: 'active', planName: 'basic' },
        refundFee: 20
      });
      expect(detail.payments).toEqual([
        expect.objectContaining({
          kind: 'initial',
          paid: 10,
          paymentFee: 1,
          refunded: 0,
          left: 8
        })
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('approved', () => {
    it('refunds what is left of its payments, and cancels the subscription now once the money is back: Refunded', async () => {
      await subscribe();
      await submitRefundRequest('u1', {});
      const id = await requestId();
      await approveRefundRequest({ id, cancelSubscription: true }, 'admin');
      expect(h.processor.refundPayment).toHaveBeenCalledWith(
        expect.anything(),
        { minor: 800, whole: false }
      );
      expect(await h.db.query.refundRequests.findFirst()).toMatchObject({
        status: 'approved'
      });
      expect(await paymentOf()).toMatchObject({
        status: 'refund_pending',
        refundBy: 'admin',
        refundRequestId: id
      });
      // Held, not yet canceled: the money has not gone back.
      expect(await rowOf()).toMatchObject({
        status: 'active',
        cancelReason: 'refunded'
      });
      expect(await planOf('u1')).toBe('basic');
      // The processor confirms: the payment names the request still.
      await refund('pi_1', 8);
      expect(await paymentOf()).toMatchObject({
        status: 'refunded',
        refundAmount: '8.00',
        refundRequestId: id
      });
      expect(await rowOf()).toMatchObject({
        status: 'canceled',
        cancelReason: 'refunded'
      });
      expect(await planOf('u1')).toBeNull();
    });

    it('otherwise cancels the subscription when it expires, usable until then: Refunded', async () => {
      await subscribe();
      await submitRefundRequest('u1', {});
      await approveRefundRequest(
        { id: await requestId(), cancelSubscription: false },
        'admin'
      );
      expect(await paymentOf()).toMatchObject({ status: 'refund_pending' });
      await refund('pi_1', 8);
      expect(await rowOf()).toMatchObject({
        status: 'active',
        canceledAt: EXPIRES,
        cancelReason: 'refunded'
      });
      expect(await planOf('u1')).not.toBeNull();
    });

    it('waits to be decided again when its refund fails, the subscription as it was', async () => {
      await subscribe();
      await submitRefundRequest('u1', {});
      const id = await requestId();
      await approveRefundRequest({ id, cancelSubscription: true }, 'admin');
      await refundFailed('pi_1');
      expect(await h.db.query.refundRequests.findFirst()).toMatchObject({
        id,
        status: 'pending_approval'
      });
      expect(await paymentOf()).toMatchObject({ status: 'paid' });
      expect(await rowOf()).toMatchObject({
        status: 'active',
        canceledAt: null
      });
      expect(await planOf('u1')).toBe('basic');
      // And can be approved again.
      await approveRefundRequest({ id, cancelSubscription: true }, 'admin');
      expect(h.processor.refundPayment).toHaveBeenCalledTimes(2);
    });

    it('is left pending when no refund goes out', async () => {
      await subscribe();
      await submitRefundRequest('u1', {});
      h.processor.refundPayment.mockRejectedValueOnce(new Error('refused'));
      await expect(
        approveRefundRequest(
          { id: await requestId(), cancelSubscription: true },
          'admin'
        )
      ).rejects.toThrow('refused');
      expect(await h.db.query.refundRequests.findFirst()).toMatchObject({
        status: 'pending_approval'
      });
      expect(await rowOf()).toMatchObject({ status: 'active' });
    });

    it('refunded already from Payments, is approved with nothing more sent', async () => {
      await subscribe();
      await submitRefundRequest('u1', {});
      const id = await requestId();
      await refundPayment(
        { paymentId: (await paymentOf())!.id, cancelSubscription: false },
        'admin'
      );
      await approveRefundRequest({ id, cancelSubscription: true }, 'admin');
      expect(await h.db.query.refundRequests.findFirst()).toMatchObject({
        status: 'approved'
      });
      expect(h.processor.refundPayment).toHaveBeenCalledTimes(1);
      // The subscription as the refund from Payments left it.
      expect(await rowOf()).toMatchObject({
        status: 'active',
        cancelReason: 'refunded'
      });
    });

    it('is decided once', async () => {
      await subscribe();
      await submitRefundRequest('u1', {});
      const id = await requestId();
      await approveRefundRequest({ id, cancelSubscription: false }, 'admin');
      await expect(
        approveRefundRequest({ id, cancelSubscription: false }, 'admin')
      ).rejects.toThrow('already been decided');
    });
  });

  it('rejected leaves the subscription as it is, with the reason', async () => {
    await subscribe();
    await submitRefundRequest('u1', {});
    await rejectRefundRequest({
      id: await requestId(),
      reason: 'Past the fair-use limit'
    });
    expect(await h.db.query.refundRequests.findFirst()).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Past the fair-use limit'
    });
    expect(await rowOf()).toMatchObject({ status: 'active' });
    expect(h.processor.refundPayment).not.toHaveBeenCalled();
  });

  it('can be made as many times as the setting allows, rejected ones counted', async () => {
    h.refunds.maxRequests = 2;
    await subscribe();
    await submitRefundRequest('u1', {});
    await rejectRefundRequest({ id: await requestId() });
    expect(await getMyRefundRequest('u1')).toMatchObject({
      canRequest: true,
      rules: { requestsLeft: 1 }
    });
    await submitRefundRequest('u1', {});
    await rejectRefundRequest({ id: await requestId() });
    const used =
      'Your refund request was rejected, and no more can be made for this subscription.';
    expect(await getMyRefundRequest('u1')).toMatchObject({
      canRequest: false,
      unavailable: used,
      latest: { status: 'rejected' },
      rules: { requestsLeft: 0 }
    });
    await expect(submitRefundRequest('u1', {})).rejects.toThrow(used);
  });

  it('can be made again and again with no limit set', async () => {
    await subscribe();
    for (let i = 0; i < 3; i++) {
      await submitRefundRequest('u1', {});
      await rejectRefundRequest({ id: await requestId() });
    }
    expect(await getMyRefundRequest('u1')).toMatchObject({
      canRequest: true,
      rules: { requestsLeft: null }
    });
  });

  it('counts per subscription: a new one starts again', async () => {
    h.refunds.maxRequests = 1;
    await subscribe();
    await submitRefundRequest('u1', {});
    await rejectRefundRequest({ id: await requestId() });
    expect((await getMyRefundRequest('u1'))!.canRequest).toBe(false);
    await report({ status: 'canceled' });
    await subscribe(
      { externalId: 'sub_2' },
      { externalId: 'in_2', transactionId: 'pi_2' }
    );
    expect(await getMyRefundRequest('u1')).toMatchObject({
      canRequest: true,
      rules: { requestsLeft: 1 }
    });
  });

  it('is listed for the console with how many wait to be decided', async () => {
    await subscribe();
    await submitRefundRequest('u1', {});
    const list = await listRefundRequests({ page: 1, pageSize: 20 });
    expect(list).toMatchObject({ total: 1, pendingApproval: 1 });
    expect(list.rows[0]).toMatchObject({
      status: 'pending_approval',
      user: { id: 'u1' },
      subscription: { status: 'active', plan: { name: 'basic' } }
    });
    for (const [q, total] of [
      ['u1@test', 1],
      ['U1', 1],
      ['nobody', 0]
    ] as const) {
      expect(
        (await listRefundRequests({ page: 1, pageSize: 20, q })).total
      ).toBe(total);
    }
  });
});

describe('a cancellation that is not the user’s own', () => {
  const refundedAtExpiry = async () => {
    await subscribe();
    await refundPayment(
      { paymentId: (await paymentOf())!.id, cancelSubscription: false },
      'admin'
    );
    await refund('pi_1', 8);
  };

  it('set by an admin cannot be resumed or upgraded out of by the user', async () => {
    await subscribe();
    await adminCancelSubscription((await rowOf())!.id, 'admin');
    expect(await getMySubscription('u1')).toMatchObject({
      canResume: false,
      canUpgrade: false
    });
    await expect(resubscribe('u1')).rejects.toThrow('cannot be resumed');
    await expect(upgradePlan('u1', { planId: 'pro' })).rejects.toThrow(
      'cannot be upgraded'
    );
    expect(await rowOf()).toMatchObject({
      planId: 'basic',
      canceledAt: EXPIRES,
      cancelReason: 'canceled_by_admin',
      canceledBy: 'admin'
    });
    expect(h.processor.changeNow).not.toHaveBeenCalled();
  });

  it('left by a refund cannot be resumed or upgraded out of either', async () => {
    await refundedAtExpiry();
    await expect(resubscribe('u1')).rejects.toThrow('cannot be resumed');
    await expect(upgradePlan('u1', { planId: 'pro' })).rejects.toThrow(
      'cannot be upgraded'
    );
    expect(await rowOf()).toMatchObject({ cancelReason: 'refunded' });
  });

  it('the user’s own still can be', async () => {
    await subscribe();
    await cancelSubscription('u1');
    expect(await rowOf()).toMatchObject({ canceledBy: 'u1' });
    expect(await getMySubscription('u1')).toMatchObject({
      canResume: true,
      canUpgrade: true
    });
    await resubscribe('u1');
    expect(await rowOf()).toMatchObject({ canceledAt: null, canceledBy: null });
  });

  it('set in the processor is no one’s here: not resumed from the app, but the processor’s to unset', async () => {
    await subscribe();
    await report({ cancelAtPeriodEnd: true });
    expect(await rowOf()).toMatchObject({
      cancelReason: 'canceled_in_processor',
      canceledBy: null
    });
    await expect(resubscribe('u1')).rejects.toThrow('cannot be resumed');
    await report({ cancelAtPeriodEnd: false });
    expect(await rowOf()).toMatchObject({
      canceledAt: null,
      cancelReason: null
    });
  });

  it('resumed in the processor stands, and is set to cancel there again', async () => {
    await refundedAtExpiry();
    h.processor.cancelAtPeriodEnd.mockClear();
    await report({ cancelAtPeriodEnd: false });
    expect(await rowOf()).toMatchObject({
      status: 'active',
      canceledAt: EXPIRES,
      cancelReason: 'refunded'
    });
    expect(h.processor.cancelAtPeriodEnd).toHaveBeenCalledWith('sub_1');
  });
});

describe('a subscription ended here that the processor keeps going', () => {
  const refundedNow = async () => {
    await subscribe();
    await refundPayment(
      { paymentId: (await paymentOf())!.id, cancelSubscription: true },
      'admin'
    );
    await refund('pi_1', 8);
  };

  it('is cancelled there again, whatever it was canceled for', async () => {
    await refundedNow();
    h.processor.cancelNow.mockClear();
    await report({ status: 'active', cancelAtPeriodEnd: false });
    expect(await rowOf()).toMatchObject({
      status: 'canceled',
      cancelReason: 'refunded'
    });
    expect(h.processor.cancelNow).toHaveBeenCalledWith('sub_1');
    expect(await planOf('u1')).toBeNull();
  });

  it('and charged for after its end keeps that payment as paid, for an admin to refund', async () => {
    await refundedNow();
    h.processor.refundPayment.mockClear();
    await pay({
      externalId: 'in_2',
      transactionId: 'pi_2',
      kind: 'renewal',
      billedAt: inDays(1)
    });
    expect(h.processor.refundPayment).not.toHaveBeenCalled();
    expect(await paymentOf('in_2')).toMatchObject({ status: 'paid' });
    expect(await rowOf()).toMatchObject({ status: 'canceled' });
    expect(await planOf('u1')).toBeNull();
  });

  it('but a payment made while it still ran, reported late, is kept', async () => {
    await subscribe();
    await report({ status: 'canceled' });
    h.processor.refundPayment.mockClear();
    await pay({
      externalId: 'in_0',
      transactionId: 'pi_0',
      billedAt: daysAgo(3)
    });
    expect(h.processor.refundPayment).not.toHaveBeenCalled();
    expect(await paymentOf('in_0')).toMatchObject({ status: 'paid' });
  });
});

describe('without a webhook', () => {
  it('a subscription past its expiry is read from the processor by the scheduled job: canceled there, canceled here', async () => {
    await subscribe({ expiresAt: daysAgo(2) });
    Object.assign(h.processor.subs.get('sub_1'), { status: 'canceled' });
    expect(await planOf('u1')).toBe('basic');
    await runScheduledJob();
    expect(await rowOf()).toMatchObject({ status: 'canceled' });
    expect(await planOf('u1')).toBeNull();
  });

  it('one not yet expired is not asked about, and a processor not answering leaves the plan', async () => {
    await subscribe();
    h.processor.getSubscription.mockClear();
    await runScheduledJob();
    expect(h.processor.getSubscription).not.toHaveBeenCalled();

    await subscribe(
      {
        externalId: 'sub_8',
        customerId: 'cus_u2',
        userId: 'u2',
        expiresAt: daysAgo(2)
      },
      { externalId: 'in_8', transactionId: 'pi_8' }
    );
    h.processor.getSubscription.mockRejectedValueOnce(new Error('down'));
    await runScheduledJob();
    expect(await planOf('u2')).toBe('basic');
  });

  it('a checkout come back from is asked of the processor, and kept as its webhook would have', async () => {
    processorSubscription();
    expect(await rowOf()).toBeUndefined();
    await confirmCheckout(user, { via: 'stripe', ref: 'cs_1' });
    expect(h.processor.findSubscriptions).toHaveBeenCalledWith({
      ref: 'cs_1',
      userId: 'u1',
      email: 'u1@test.com'
    });
    expect(await rowOf()).toMatchObject({ status: 'active', userId: 'u1' });
    expect(await planOf('u1')).toBe('basic');
    // Asked again, nothing more.
    h.processor.findSubscriptions.mockClear();
    await confirmCheckout(user, { via: 'stripe', ref: 'cs_1' });
    expect(h.processor.findSubscriptions).not.toHaveBeenCalled();
  });

  it('nothing found, or the processor not answering, changes nothing', async () => {
    h.processor.findSubscriptions.mockRejectedValueOnce(new Error('down'));
    await confirmCheckout(user, { via: 'stripe', ref: 'cs_1' });
    expect(await rowOf()).toBeUndefined();
  });
});

describe('the scheduled job, for webhooks that never came', () => {
  /** A refund sent from here a day and more ago, its webhook never come. */
  const refundAgo = async (cancelSubscription: boolean) => {
    await subscribe();
    await refundPayment(
      { paymentId: (await paymentOf())!.id, cancelSubscription },
      'admin'
    );
    await h.db
      .update(schema.payments)
      .set({ refundAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
  };
  const refundState = (status: 'pending' | 'succeeded' | 'failed') =>
    h.processor.getRefund.mockResolvedValue({
      externalId: 're_1',
      amount: 8,
      total: null,
      status
    });

  it('asks about a refund sent from here a day ago and still waiting: gone back, it cancels as it owed', async () => {
    await refundAgo(true);
    refundState('succeeded');
    expect(await runScheduledJob()).toMatchObject({
      refunds: 1,
      failed: 0
    });
    expect(h.processor.getRefund).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'in_1' }),
      're_1'
    );
    expect(await paymentOf()).toMatchObject({
      status: 'refunded',
      refundAmount: '8.00'
    });
    expect(await rowOf()).toMatchObject({
      status: 'canceled',
      cancelReason: 'refunded'
    });
    expect(await planOf('u1')).toBeNull();
  });

  it('leaves a refund the processor is still working on', async () => {
    await refundAgo(true);
    refundState('pending');
    await runScheduledJob();
    expect(await paymentOf()).toMatchObject({ status: 'refund_pending' });
    expect(await rowOf()).toMatchObject({ cancelReason: 'refunded' });
  });

  it('finds a refund sent from here failed: paid again, the subscription renewing', async () => {
    await refundAgo(true);
    refundState('failed');
    await runScheduledJob();
    expect(await paymentOf()).toMatchObject({
      status: 'paid',
      refundAmount: '0.00'
    });
    expect(await rowOf()).toMatchObject({ status: 'active', canceledAt: null });
    expect(await planOf('u1')).toBe('basic');
  });

  it('does not ask about a refund sent within the day', async () => {
    await subscribe();
    await refundPayment(
      { paymentId: (await paymentOf())!.id, cancelSubscription: true },
      'admin'
    );
    expect(await runScheduledJob()).toMatchObject({ refunds: 0 });
    expect(h.processor.getRefund).not.toHaveBeenCalled();
  });

  it('ends a subscription past its expiry whose user never came back', async () => {
    await subscribe({ expiresAt: daysAgo(2) });
    Object.assign(h.processor.subs.get('sub_1'), { status: 'canceled' });
    expect(await runScheduledJob()).toMatchObject({ expired: 1 });
    expect(await rowOf()).toMatchObject({ status: 'canceled' });
    expect(await planOf('u1')).toBeNull();
  });

  it('ends a subscription whose renewal failed and whose grace days are over, without asking the processor', async () => {
    await subscribe();
    await pay({
      externalId: 'in_2',
      transactionId: 'pi_2',
      kind: 'renewal',
      paid: false
    });
    await h.db.update(schema.subscriptions).set({ expiresAt: daysAgo(4) });
    h.processor.getSubscription.mockClear();
    expect(await runScheduledJob()).toMatchObject({
      expired: 0,
      unpaid: 1
    });
    expect(h.processor.getSubscription).not.toHaveBeenCalled();
    expect(await rowOf()).toMatchObject({
      status: 'canceled',
      cancelReason: 'payment_failed'
    });
    expect(h.processor.cancelNow).toHaveBeenCalledWith('sub_1');
    expect(await planOf('u1')).toBeNull();
  });

  it('leaves one whose renewal failed within its grace days alone', async () => {
    await subscribe();
    await pay({
      externalId: 'in_2',
      transactionId: 'pi_2',
      kind: 'renewal',
      paid: false
    });
    await h.db.update(schema.subscriptions).set({ expiresAt: daysAgo(2) });
    expect(await runScheduledJob()).toMatchObject({
      expired: 0,
      unpaid: 0
    });
    expect(await rowOf()).toMatchObject({ status: 'active' });
  });

  it('leaves what it cannot read for the next run, and goes on', async () => {
    await refundAgo(true);
    h.processor.getRefund.mockRejectedValueOnce(new Error('down'));
    expect(await runScheduledJob()).toMatchObject({
      refunds: 1,
      failed: 1
    });
    expect(await paymentOf()).toMatchObject({ status: 'refund_pending' });
  });
});

describe('the charge of an upgrade', () => {
  it('is asked of the processor beforehand, for the user to see', async () => {
    await subscribe();
    expect(await previewUpgrade('u1', { planId: 'pro' })).toEqual({
      amount: 7.5
    });
    expect(h.processor.previewChange).toHaveBeenCalledWith('sub_1', {
      priceId: 'price_pro_m'
    });
    h.processor.previewChange.mockRejectedValueOnce(new Error('down'));
    expect(await previewUpgrade('u1', { planId: 'pro' })).toEqual({
      amount: null
    });
  });
});

describe('the console’s payments', () => {
  it('filter by status, processor and user — a deleted one by the email kept', async () => {
    await subscribe();
    const all = { page: 1, pageSize: 20 };
    for (const [filter, total] of [
      [{}, 1],
      [{ status: 'paid' as const }, 1],
      [{ status: 'refunded' as const }, 0],
      [{ processor: 'stripe' as const }, 1],
      [{ processor: 'paddle' as const }, 0],
      [{ q: 'u1@test' }, 1],
      [{ q: 'U1' }, 1],
      [{ q: 'nobody' }, 0]
    ] as const) {
      expect((await listPayments({ ...all, ...filter })).total).toBe(total);
    }
    await h.db
      .update(schema.users)
      .set({ email: 'moved@test.com' })
      .where(eq(schema.users.id, 'u1'));
    // The email the payment kept still finds it.
    expect((await listPayments({ ...all, q: 'u1@test' })).total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The console, and deleting a user
// ---------------------------------------------------------------------------

describe('the console', () => {
  it('lists subscriptions by status, processor and user, with what each paid and had back', async () => {
    await subscribe();
    await refundPayment(
      {
        paymentId: (await paymentOf())!.id,
        cancelSubscription: false
      },
      'admin'
    );
    await refund('pi_1', 3);

    const all = await listSubscriptions({ page: 1, pageSize: 20 });
    expect(all.rows[0]).toMatchObject({
      planName: 'basic',
      price: 10,
      status: 'active',
      expiresAt: EXPIRES,
      processor: 'stripe',
      paid: 10
    });
    for (const [filter, total] of [
      [{ status: 'canceled' as const }, 0],
      [{ processor: 'paddle' as const }, 0],
      [{ q: 'u1@test' }, 1],
      [{ q: 'nobody' }, 0]
    ] as const) {
      expect(
        (await listSubscriptions({ page: 1, pageSize: 20, ...filter })).total
      ).toBe(total);
    }
  });

  it('opens one whole: its next charge, payments, refund requests and link', async () => {
    await subscribe();
    await submitRefundRequest('u1', { reason: 'why' });
    const detail = await getSubscriptionDetail((await rowOf())!.id);
    expect(detail).toMatchObject({
      status: 'active',
      nextCharge: { at: EXPIRES, amount: 10 },
      customerId: 'cus_u1',
      dashboardUrl: 'https://pay.example/subs/sub_1'
    });
    expect(detail.payments).toHaveLength(1);
    expect(detail.refundRequests[0]).toMatchObject({ reason: 'why' });
  });
});

describe('deleting a user', () => {
  it('is refused while their subscription is active, even set to cancel', async () => {
    await subscribe();
    await cancelSubscription('u1');
    await expect(deleteUser('admin', 'u1')).rejects.toThrow(
      'active subscription'
    );
  });

  it('goes ahead once it is canceled, keeping the payments with the email paid under', async () => {
    await subscribe();
    await report({ status: 'canceled' });
    await expect(deleteUser('admin', 'u1')).resolves.toEqual({
      success: true
    });
    expect(await rowOf()).toBeUndefined();
    expect(await paymentOf()).toMatchObject({
      userId: null,
      subscriptionId: null,
      userEmail: 'u1@test.com',
      planId: 'basic',
      amount: '10.00'
    });
  });
});
