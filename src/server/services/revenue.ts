import '@tanstack/react-start/server-only';

import {
  and,
  asc,
  count,
  eq,
  gte,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQLWrapper
} from 'drizzle-orm';
import { type z } from 'zod';

import { pageWindow } from '@/types/pagination';
import { billingIntervalOf } from '@/types/payment';
import { type revenueLossUsersSchema } from '@/types/revenue';
import { BILLING_INTERVALS } from '@/lib/constant';
import { db } from '@/db';
import { payments, plans, subscriptions, usage, users } from '@/db/schema';
import { dayOf, stepOf, sumOf } from '@/server/services/db-utils';

/*
 * The Revenue page's figures, summed in SQL so that only they leave the
 * database, however many calls a window holds. The business sells
 * subscriptions, and pays for the models its users call: subscriptions are
 * its income, model calls its expense.
 *
 * - A payment's net is what it kept: its amount, less what has gone back of
 *   it, less the tax in what is left. A failed payment took nothing; a
 *   disputed one has had its money pulled back; a refund still waiting has
 *   not gone back yet.
 * - Revenue is a payment's net spread evenly over the period it pays for —
 *   from when it was charged to the period end it names, or one interval of
 *   its plan where it names none. Cash is the net of the payments charged in
 *   the window.
 * - Cost is what the window's calls cost; spend what users spent on them, at
 *   their tier's price. Profit is revenue less cost.
 * - A subscription is in effect from when it began until it ended. A
 *   duplicate — a second one bought beside the first, ended and refunded —
 *   never was one. Subscribers are those in effect at the window's close,
 *   and MRR those of them still to renew: one cancelled by then is in
 *   effect until it ends, but brings in no more. Started and churned are
 *   those that began and ended in the window.
 *
 * A window is two timestamps, `from` and `to`, as every report's is; its
 * days are every 86,400 seconds from `from` — or, over a window of one day,
 * its hours, each "day" below then an hour. Each table is read once, and
 * summed by plan and day together.
 */

/** A month, in days, as a monthly plan is billed. */
const MONTH_DAYS = billingIntervalOf('month').days;

/** A window, and where its days begin: every `step` seconds from `since`. */
type Window = { since: Date; end: Date; step: number };

/** A window from `since` to `until`, or now: never past now, since what a
 *  payment brings in accrues with time, and a range of days that takes in
 *  today ends tonight. */
function windowOf(since: Date, until?: Date, step = stepOf()): Window {
  const now = new Date();
  return { since, end: until && until < now ? until : now, step };
}

const seconds = (d: Date) => d.getTime() / 1000;

/** An instant as epoch seconds. */
const epochOf = (instant: SQLWrapper) =>
  sql<number>`extract(epoch from ${instant})::float8`;

/** A plan's interval in days, as `BILLING_INTERVALS` gives it. */
const intervalDays = sql<number>`(case ${plans.interval} ${sql.join(
  BILLING_INTERVALS.map(i => sql`when ${i.value} then ${i.days}::float8`),
  sql` `
)} end)`;

/** How many days the window has, the last perhaps cut short. */
const dayCountOf = (w: Window) =>
  Math.max(1, Math.ceil((seconds(w.end) - seconds(w.since)) / w.step));

/**
 * The payments whose period reaches into the window: what each kept, the
 * epoch seconds its period runs between, and the days of the window it
 * covers.
 */
function paidIn(w: Window) {
  // Where the processor named no period end, one interval of the plan on
  // the calendar: a plan's interval is itself a Postgres unit.
  const periodEnd = sql`case when ${payments.periodEnd} > ${payments.billedAt}
    then ${payments.periodEnd}
    else ${payments.billedAt} + ('1 ' || ${plans.interval})::interval end`;
  return db.$with('paid').as(
    db
      .select({
        userId: payments.userId,
        planId: payments.planId,
        net: sql<number>`(case
          when ${or(eq(payments.status, 'disputed'), lte(payments.amount, '0'))} then 0
          else (${payments.amount} - case when ${eq(payments.status, 'refunded')}
              then ${payments.refundAmount} else 0 end)
            * (${payments.amount} - coalesce(${payments.tax}, 0)
              - coalesce(${payments.sellerTax}, 0))
            / ${payments.amount}
        end)::float8`.as('net'),
        starts: epochOf(payments.billedAt).as('starts'),
        ends: epochOf(periodEnd).as('ends'),
        billedDay: dayOf(w.since, payments.billedAt, w.step).as('billed_day'),
        firstDay: dayOf(
          w.since,
          sql`greatest(${payments.billedAt}, ${w.since})`,
          w.step
        ).as('first_day'),
        lastDay: dayOf(
          w.since,
          sql`least(${periodEnd}, ${w.end}) - interval '1 microsecond'`,
          w.step
        ).as('last_day')
      })
      .from(payments)
      .innerJoin(plans, eq(plans.id, payments.planId))
      .where(
        and(
          ne(payments.status, 'failed'),
          lt(payments.billedAt, w.end),
          sql`${periodEnd} > ${w.since}`
        )
      )
  );
}

/**
 * Each day of the window a payment's period covers, with the epoch seconds
 * the day runs between: joined laterally, one row per payment and day.
 */
function coveredBy(w: Window, paid: ReturnType<typeof paidIn>) {
  const since = sql`${seconds(w.since)}::float8`;
  return db
    .select({
      day: sql<number>`day`.as('day'),
      starts: sql<number>`${since} + (day - 1) * ${w.step}::float8`.as(
        'day_starts'
      ),
      ends: sql<number>`least(${since} + day * ${w.step}::float8, ${seconds(w.end)}::float8)`.as(
        'day_ends'
      )
    })
    .from(sql`generate_series(${paid.firstDay}, ${paid.lastDay}) as day`)
    .as('covered');
}

/** The share of a payment's net between two epoch instants. */
const recognized = (
  paid: ReturnType<typeof paidIn>,
  from: SQLWrapper | number,
  to: SQLWrapper | number
) =>
  sql<number>`${paid.net} * greatest(0, least(${paid.ends}, ${to})
    - greatest(${paid.starts}, ${from})) / (${paid.ends} - ${paid.starts})`;

/** The window's calls, each on its day and counted against the plan its
 *  user was on; none, a free user's. */
function usedIn(w: Window) {
  return db.$with('used').as(
    db
      .select({
        userId: usage.userId,
        day: dayOf(w.since, usage.createdAt, w.step).as('day'),
        planId: usage.planId,
        cost: sql<number>`coalesce(${usage.cost}, 0)::float8`.as('cost'),
        spend: sql<number>`coalesce(${usage.spend}, 0)::float8`.as('spend')
      })
      .from(usage)
      .where(and(gte(usage.createdAt, w.since), lt(usage.createdAt, w.end)))
  );
}

/**
 * The subscriptions in effect at some point of the window: the day each
 * began (0 or less, before the window), the day it ended (none while still
 * in effect at the window's close), whether it was cancelled by the close,
 * and its price as a month.
 */
function subscribedIn(w: Window) {
  return db.$with('subscribed').as(
    db
      .select({
        planId: subscriptions.planId,
        startedDay: dayOf(w.since, subscriptions.createdAt, w.step).as(
          'started_day'
        ),
        endedDay: sql<
          number | null
        >`case when ${subscriptions.endedAt} < ${w.end}
          then ${dayOf(w.since, subscriptions.endedAt, w.step)} end`.as(
          'ended_day'
        ),
        canceled:
          sql<boolean>`coalesce(${subscriptions.canceledAt} < ${w.end}, false)`.as(
            'canceled'
          ),
        monthly: sql<number>`${plans.price}::float8 * ${MONTH_DAYS}::float8
          / ${intervalDays}`.as('monthly')
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(
        and(
          or(
            isNull(subscriptions.reason),
            ne(subscriptions.reason, 'duplicate')
          ),
          lt(subscriptions.createdAt, w.end),
          or(isNull(subscriptions.endedAt), gte(subscriptions.endedAt, w.since))
        )
      )
  );
}

/**
 * The Revenue page over a window: each plan's figures, the free users' as
 * one more under no plan, and each day's. Payments, calls and subscriptions
 * are each read once, summed by plan and day together.
 */
export async function adminRevenue(since: Date, until?: Date, step?: number) {
  const w = windowOf(since, until, step);
  const paid = paidIn(w);
  const covered = coveredBy(w, paid);
  const used = usedIn(w);
  const subscribed = subscribedIn(w);

  const [planRows, income, expense, counts] = await Promise.all([
    db
      .select({ id: plans.id, name: plans.name, interval: plans.interval })
      .from(plans)
      .orderBy(asc(plans.displayOrder), asc(plans.name)),
    // Each payment spread over only the days its period covers.
    db
      .with(paid)
      .select({
        planId: paid.planId,
        day: covered.day,
        revenue: sumOf(recognized(paid, covered.starts, covered.ends)),
        cash: sql<number>`coalesce(sum(${paid.net}) filter (where ${paid.billedDay} = ${covered.day}), 0)::float8`.mapWith(
          Number
        )
      })
      .from(paid)
      .crossJoinLateral(covered)
      .groupBy(paid.planId, covered.day),
    db
      .with(used)
      .select({
        planId: used.planId,
        day: used.day,
        cost: sumOf(used.cost),
        spend: sumOf(used.spend)
      })
      .from(used)
      .groupBy(used.planId, used.day),
    db
      .with(subscribed)
      .select({
        planId: subscribed.planId,
        startedDay: subscribed.startedDay,
        endedDay: subscribed.endedDay,
        canceled: subscribed.canceled,
        count: count(),
        monthly: sumOf(subscribed.monthly)
      })
      .from(subscribed)
      .groupBy(
        subscribed.planId,
        subscribed.startedDay,
        subscribed.endedDay,
        subscribed.canceled
      )
  ]);

  const dayRows = Array.from({ length: dayCountOf(w) }, (_, i) => ({
    start: new Date(w.since.getTime() + i * w.step * 1000),
    revenue: 0,
    cost: 0,
    started: 0,
    churned: 0,
    subscribers: 0
  }));
  const emptyPlan = (planId: string | null) => ({
    planId,
    subscribers: 0,
    canceled: 0,
    mrr: 0,
    started: 0,
    churned: 0,
    revenue: 0,
    cash: 0,
    spend: 0,
    cost: 0
  });
  const byPlan = new Map<string | null, ReturnType<typeof emptyPlan>>();
  const planOf = (planId: string | null) => {
    let row = byPlan.get(planId);
    if (!row) {
      row = emptyPlan(planId);
      byPlan.set(planId, row);
    }
    return row;
  };

  for (const r of income) {
    const plan = planOf(r.planId);
    plan.revenue += r.revenue;
    plan.cash += r.cash;
    dayRows[r.day - 1].revenue += r.revenue;
  }
  for (const r of expense) {
    const plan = planOf(r.planId);
    plan.cost += r.cost;
    plan.spend += r.spend;
    dayRows[r.day - 1].cost += r.cost;
  }
  // Those in effect when the window began, then each day's changes.
  let subscribers = 0;
  for (const r of counts) {
    const plan = planOf(r.planId);
    if (r.endedDay == null) {
      plan.subscribers += r.count;
      if (r.canceled) plan.canceled += r.count;
      else plan.mrr += r.monthly;
    } else {
      plan.churned += r.count;
      dayRows[r.endedDay - 1].churned += r.count;
    }
    if (r.startedDay >= 1) {
      plan.started += r.count;
      dayRows[r.startedDay - 1].started += r.count;
    } else {
      subscribers += r.count;
    }
  }
  for (const day of dayRows) {
    subscribers += day.started - day.churned;
    day.subscribers = subscribers;
  }

  return {
    plans: planRows,
    byPlan: [...byPlan.values()].map(r => ({
      ...r,
      profit: r.revenue - r.cost
    })),
    days: dayRows
  };
}

/**
 * One page of the users the business lost money on over a window — whose
 * calls cost more than their payments brought in — the biggest loss first.
 * Only a user with calls can cost anything, and a deleted user's calls go
 * with them, so every one is a user still here.
 */
export async function adminRevenueLossUsers(
  page: z.infer<typeof revenueLossUsersSchema>
) {
  const w = windowOf(page.from, page.to);
  const paid = paidIn(w);
  const used = usedIn(w);
  const income = db.$with('income').as(
    db
      .with(paid)
      .select({
        userId: paid.userId,
        revenue:
          sql<number>`sum(${recognized(paid, seconds(w.since), seconds(w.end))})`.as(
            'revenue'
          )
      })
      .from(paid)
      .groupBy(paid.userId)
  );
  const expense = db.$with('expense').as(
    db
      .with(used)
      .select({
        userId: used.userId,
        cost: sql<number>`sum(${used.cost})`.as('cost'),
        spend: sql<number>`sum(${used.spend})`.as('spend')
      })
      .from(used)
      .groupBy(used.userId)
  );
  const loss = db.$with('loss').as(
    db
      .with(income, expense)
      .select({
        userId: expense.userId,
        revenue: sql<number>`coalesce(${income.revenue}, 0)`.as('revenue'),
        cost: expense.cost,
        spend: expense.spend
      })
      .from(expense)
      .leftJoin(income, eq(income.userId, expense.userId))
      .where(sql`${expense.cost} > coalesce(${income.revenue}, 0)`)
  );

  const { limit, offset } = pageWindow(page);
  const [rows, [totalRow]] = await Promise.all([
    db
      .with(loss)
      .select({
        revenue: loss.revenue,
        cost: loss.cost,
        spend: loss.spend,
        user: {
          id: users.id,
          name: users.name,
          email: users.email,
          planId: users.planId
        }
      })
      .from(loss)
      .innerJoin(users, eq(users.id, loss.userId))
      .orderBy(asc(sql`${loss.revenue} - ${loss.cost}`), asc(users.id))
      .limit(limit)
      .offset(offset),
    db.with(loss).select({ count: count() }).from(loss)
  ]);

  return {
    rows: rows.map(r => ({ ...r, profit: r.revenue - r.cost })),
    total: Number(totalRow?.count ?? 0),
    page: page.page,
    pageSize: page.pageSize
  };
}
