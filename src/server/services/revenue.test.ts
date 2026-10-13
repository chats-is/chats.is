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

import { billingIntervalOf, type SubscriptionReason } from '@/types/payment';
import * as schema from '@/db/schema';

/**
 * The Revenue page's figures, against a real Postgres: payments spread over
 * the time they pay for, subscriptions begun, ended and in effect, and calls
 * counted against the plan each kept — by plan, by day, and the users the
 * business lost money on.
 */

const h = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('@/db', () => ({
  get db() {
    return h.db;
  }
}));

const { adminRevenue, adminRevenueLossUsers } =
  await import('@/server/services/revenue');

let client: { close?: () => Promise<void> } | undefined;

beforeAll(async () => {
  const t = await makeTestDb();
  h.db = t.db;
  client = t.client;
});

afterAll(async () => {
  await client?.close?.();
});

const DAY = 24 * 60 * 60 * 1000;
/** A fixed window of ten days, from midnight UTC. */
const T0 = new Date('2026-09-01T00:00:00Z');
const day = (n: number, hours = 0) =>
  new Date(T0.getTime() + n * DAY + hours * 60 * 60 * 1000);
const END = day(10);
let seq = 0;

beforeEach(async () => {
  await h.db.delete(schema.usage);
  await h.db.delete(schema.payments);
  await h.db.delete(schema.subscriptions);
  await h.db.update(schema.users).set({ planId: null });
  await h.db.delete(schema.users);
  await h.db.delete(schema.plans);
  await h.db.delete(schema.quotas);
  await h.db.insert(schema.quotas).values({ id: 'q', name: 'Q' });
  await h.db.insert(schema.plans).values([
    {
      id: 'pro',
      name: 'Pro',
      quotaId: 'q',
      processor: 'stripe',
      interval: 'month',
      price: '20',
      priceId: 'price_pro'
    },
    {
      id: 'daily',
      name: 'Daily',
      quotaId: 'q',
      processor: 'stripe',
      interval: 'day',
      price: '1',
      priceId: 'price_daily'
    }
  ]);
  await h.db.insert(schema.users).values([
    { id: 'a', name: 'A', email: 'a@x.test', planId: 'pro' },
    { id: 'b', name: 'B', email: 'b@x.test' },
    { id: 'c', name: 'C', email: 'c@x.test' }
  ]);
});

async function pay(
  billedAt: Date,
  periodEnd: Date | null,
  more: Partial<typeof schema.payments.$inferInsert> = {}
) {
  seq += 1;
  await h.db.insert(schema.payments).values({
    id: `p${seq}`,
    userId: 'a',
    userEmail: 'a@x.test',
    planId: 'pro',
    processor: 'stripe',
    kind: 'initial',
    externalId: `in_${seq}`,
    amount: '20',
    status: 'paid',
    billedAt,
    periodEnd,
    ...more
  });
}

async function subscribe(
  userId: string,
  createdAt: Date,
  ended?: { at: Date; reason: SubscriptionReason },
  planId = 'pro'
) {
  seq += 1;
  await h.db.insert(schema.subscriptions).values({
    id: `s${seq}`,
    userId,
    planId,
    processor: 'stripe',
    externalId: `sub_${seq}`,
    customerId: 'cus',
    status: ended ? 'ended' : 'active',
    periodEnd: ended?.at ?? day(40),
    canceledAt: ended?.at ?? null,
    endedAt: ended?.at ?? null,
    reason: ended?.reason ?? null,
    createdAt
  });
}

async function use(
  userId: string,
  createdAt: Date,
  planId: string | null = null,
  cost = '1'
) {
  seq += 1;
  await h.db.insert(schema.usage).values({
    id: `u${seq}`,
    userId,
    capability: 'chat',
    cost,
    spend: String(Number(cost) * 2),
    planId,
    createdAt
  });
}

const planRow = (
  report: Awaited<ReturnType<typeof adminRevenue>>,
  planId: string | null
) => report.byPlan.find(r => r.planId === planId);

describe('adminRevenue', () => {
  it('spreads what a payment kept over the period it pays for', async () => {
    // Twenty days, half in the window: $10 of it, $1 a day.
    await pay(day(-10), day(10));
    // Charged in the window, a fifth of its period in it, $2 of tax and $5
    // refunded: (20 - 5) × (20 - 2) / 20 = 13.5, a fifth of it 2.7.
    await pay(day(8), day(18), {
      tax: '2',
      refundAmount: '5',
      status: 'refunded'
    });
    // A refund still waiting has not gone back: $20, a fifth of it 4.
    await pay(day(8), day(18), {
      refundAmount: '20',
      status: 'refund_pending'
    });
    // A disputed one and a failed one took nothing; one over before, nothing.
    await pay(day(5), day(15), { status: 'disputed' });
    await pay(day(5), day(15), { status: 'failed' });
    await pay(day(-40), day(-10));

    const report = await adminRevenue(day(0), END);
    const pro = planRow(report, 'pro')!;
    expect(pro.revenue).toBeCloseTo(10 + 2.7 + 4);
    // Charged in the window: 13.5 + 20.
    expect(pro.cash).toBeCloseTo(33.5);
    // Day by day, adding up to the window.
    expect(report.days[0].revenue).toBeCloseTo(1);
    expect(report.days[9].revenue).toBeCloseTo(1 + 1.35 + 2);
    const sum = report.days.reduce((n, d) => n + d.revenue, 0);
    expect(sum).toBeCloseTo(pro.revenue);
  });

  it('ends a window that runs past now at now', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(day(5, 12));
    try {
      // $20 over twenty days, $1 a day, half of them still to come.
      await pay(day(-5, 12), day(15, 12));
      const report = await adminRevenue(day(4, 12), day(8));
      // A day of it, not three and a half.
      expect(planRow(report, 'pro')!.revenue).toBeCloseTo(1);
      expect(report.days).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes a period with no end named to be one interval of its plan', async () => {
    // A daily plan's payment, charged at noon on the last day: half in it.
    await pay(day(9, 12), null, { planId: 'daily', amount: '1' });
    const report = await adminRevenue(day(0), END);
    expect(planRow(report, 'daily')!.revenue).toBeCloseTo(0.5);
  });

  it('takes a month with no end named to be a calendar month', async () => {
    // Charged September 1st: through October 1st, thirty days, ten of
    // them in the window.
    await pay(day(0), null);
    const report = await adminRevenue(day(0), END);
    expect(planRow(report, 'pro')!.revenue).toBeCloseTo((20 * 10) / 30);
  });

  it('counts the subscriptions in effect, begun and ended, and no duplicate', async () => {
    await subscribe('a', day(-30));
    await subscribe('b', day(-30), {
      at: day(-20),
      reason: 'canceled_by_customer'
    });
    await subscribe('c', day(-30), { at: day(3), reason: 'payment_failed' });
    await subscribe('b', day(2), undefined, 'daily');
    await subscribe('c', day(2), { at: day(2), reason: 'duplicate' });

    const report = await adminRevenue(day(0), END);
    const pro = planRow(report, 'pro')!;
    expect(pro).toMatchObject({ subscribers: 1, started: 0, churned: 1 });
    expect(pro.mrr).toBeCloseTo(20);
    const daily = planRow(report, 'daily')!;
    expect(daily).toMatchObject({ subscribers: 1, started: 1, churned: 0 });
    expect(daily.mrr).toBeCloseTo(billingIntervalOf('month').days);
    expect(report.days.map(d => [d.started, d.churned, d.subscribers])).toEqual(
      [
        [0, 0, 2],
        [0, 0, 2],
        [1, 0, 3],
        [0, 1, 2],
        [0, 0, 2],
        [0, 0, 2],
        [0, 0, 2],
        [0, 0, 2],
        [0, 0, 2],
        [0, 0, 2]
      ]
    );
  });

  it('leaves a subscription cancelled by the close out of the MRR', async () => {
    await subscribe('a', day(-30));
    await subscribe('b', day(-30));
    await subscribe('c', day(-30));
    // b cancelled in the window, c only after it: c still renews then.
    await h.db
      .update(schema.subscriptions)
      .set({
        status: 'canceled',
        canceledAt: day(5),
        reason: 'canceled_by_customer'
      })
      .where(eq(schema.subscriptions.userId, 'b'));
    await h.db
      .update(schema.subscriptions)
      .set({
        status: 'canceled',
        canceledAt: day(12),
        reason: 'canceled_by_customer'
      })
      .where(eq(schema.subscriptions.userId, 'c'));

    const pro = planRow(await adminRevenue(day(0), END), 'pro')!;
    expect(pro).toMatchObject({ subscribers: 3, canceled: 1 });
    expect(pro.mrr).toBeCloseTo(40);
  });

  it('counts a call against the plan it kept, and one with none as free', async () => {
    // User a is on Pro now; what counts is what each call kept.
    await use('a', day(1), 'pro');
    await use('a', day(2), null);
    await use('b', day(3), null);

    const report = await adminRevenue(day(0), END);
    expect(planRow(report, 'pro')).toMatchObject({ cost: 1, spend: 2 });
    expect(planRow(report, null)).toMatchObject({ cost: 2, spend: 4 });
  });

  it('puts each call on its day, a day being 86,400 seconds from the start', async () => {
    await use('b', day(0, 1));
    await use('b', day(4, 23));
    await use('b', day(4, 1));
    await use('b', day(-1));
    await use('b', END);
    const report = await adminRevenue(day(0), END);
    expect(report.days.map(d => d.cost)).toEqual([
      1, 0, 0, 0, 2, 0, 0, 0, 0, 0
    ]);
    expect(report.days[4].start).toEqual(day(4));
  });
});

describe('adminRevenueLossUsers', () => {
  it('pages the users who cost more than they brought in, the biggest loss first', async () => {
    // a paid $10 into the window and used $4: a profit, left out.
    await pay(day(-10), day(10));
    await use('a', day(1), 'pro', '4');
    await use('b', day(1), null, '3');
    await use('c', day(1), null, '5');
    // A deleted user's payment: no calls, so never a loss.
    await pay(day(-10), day(10), { userId: null, userEmail: 'gone@x.test' });

    const first = await adminRevenueLossUsers({
      from: day(0),
      to: END,
      page: 1,
      pageSize: 1
    });
    expect(first.total).toBe(2);
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]).toMatchObject({
      user: { id: 'c', name: 'C', email: 'c@x.test', planId: null },
      revenue: 0,
      cost: 5,
      spend: 10,
      profit: -5
    });
    const second = await adminRevenueLossUsers({
      from: day(0),
      to: END,
      page: 2,
      pageSize: 1
    });
    expect(second.rows.map(r => r.user.id)).toEqual(['b']);
  });
});
