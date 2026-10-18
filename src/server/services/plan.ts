import '@tanstack/react-start/server-only';

import { and, count, eq, ne, or } from 'drizzle-orm';
import { type z } from 'zod';

import { pageWindow } from '@/types/pagination';
import {
  billingIntervalOf,
  type BillingInterval,
  type PaymentProcessorId
} from '@/types/payment';
import {
  type planCreateSchema,
  type planListSchema,
  type planUpdateSchema
} from '@/types/plan';
import { generateUUID } from '@/lib/utils';
import { db } from '@/db';
import { plans, quotas, tiers, users } from '@/db/schema';
import { PublicError } from '@/server/public-error';
import {
  planHasSubscriptions,
  plansWithSubscriptions
} from '@/server/services/subscription';

/** One page of plans, each with its quota and how many users are on it. */
export async function listPlans(page: z.infer<typeof planListSchema>) {
  const [rows, [totalRow], counts] = await Promise.all([
    db.query.plans.findMany({
      ...pageWindow(page),
      // `id` last so the order is total, which offset paging depends on.
      orderBy: (p, { asc }) => [asc(p.displayOrder), asc(p.name), asc(p.id)],
      with: { quota: true, tier: true }
    }),
    db.select({ count: count() }).from(plans),
    // Counted across every plan, not just this page: one grouped scan is
    // cheaper than narrowing it to the page's ids.
    db
      .select({ planId: users.planId, count: count() })
      .from(users)
      .groupBy(users.planId)
  ]);

  const countMap = new Map(counts.map(c => [c.planId, Number(c.count)]));
  const locked = await plansWithSubscriptions(rows.map(p => p.id));
  return {
    rows: rows.map(p => ({
      ...p,
      userCount: countMap.get(p.id) ?? 0,
      // Subscribed to: its processor, interval, price and price ID are fixed.
      isLocked: locked.has(p.id)
    })),
    total: Number(totalRow?.count ?? 0),
    page: page.page,
    pageSize: page.pageSize
  };
}

/** A tier is optional, but one that is named has to exist. */
async function requireTierExists(tierId: string) {
  const tier = await db.query.tiers.findFirst({
    where: eq(tiers.id, tierId)
  });
  if (!tier) throw new PublicError('Tier not found');
}

/** A plan without a quota behind it means nothing, so both writes check the
 *  quota exists before they commit. */
async function requireQuotaExists(quotaId: string) {
  const quota = await db.query.quotas.findFirst({
    where: eq(quotas.id, quotaId)
  });
  if (!quota) throw new PublicError('Quota not found');
}

/** What selling a plan rests on, as it is stored. */
type Selling = {
  processor: PaymentProcessorId;
  interval: BillingInterval;
  price: string;
  priceId: string;
};

const SELLING_KEYS: ReadonlyArray<keyof Selling> = [
  'processor',
  'interval',
  'price',
  'priceId'
];

/** Prices are kept to the cent. */
const priceOf = (price: number | string) => Number(price).toFixed(2);

const sameSelling = (a: Selling, b: Selling) =>
  SELLING_KEYS.every(key => a[key] === b[key]);

/**
 * A name is sold at each interval once — Pro monthly, Pro yearly — and a
 * processor's price names one plan, so a webhook can tell which. Both are
 * held by unique indexes; here they are said plainly first.
 */
async function requireFree(plan: { name: string } & Selling, planId?: string) {
  const other = await db.query.plans.findFirst({
    where: and(
      or(
        and(eq(plans.name, plan.name), eq(plans.interval, plan.interval)),
        and(
          eq(plans.processor, plan.processor),
          eq(plans.priceId, plan.priceId)
        )
      ),
      planId ? ne(plans.id, planId) : undefined
    ),
    columns: { name: true, interval: true }
  });
  if (!other) return;
  if (other.name === plan.name && other.interval === plan.interval) {
    throw new PublicError(
      `There is already a ${billingIntervalOf(plan.interval).adverb} plan named ${plan.name}.`
    );
  }
  throw new PublicError(`Plan ${other.name} already uses this price ID.`);
}

export async function createPlan(input: z.infer<typeof planCreateSchema>) {
  const id = generateUUID();
  await requireQuotaExists(input.quotaId);
  if (input.tierId) await requireTierExists(input.tierId);
  const selling: Selling = {
    processor: input.processor,
    interval: input.interval,
    price: priceOf(input.price),
    priceId: input.priceId
  };
  await requireFree({ name: input.name, ...selling });

  await db.insert(plans).values({
    id,
    name: input.name,
    description: input.description ?? null,
    quotaId: input.quotaId,
    tierId: input.tierId ?? null,
    displayOrder: input.displayOrder,
    ...selling,
    // Opened to subscribers when the admin says so, from the table.
    isEnabled: false
  });

  return { id };
}

/** One plan as the console edits it, read at the moment the form opens. */
export async function getPlan(id: string) {
  const plan = await db.query.plans.findFirst({
    where: eq(plans.id, id),
    with: { quota: true, tier: true }
  });
  if (!plan) return plan;
  return { ...plan, isLocked: await planHasSubscriptions(id) };
}

/**
 * Change a plan. Its quota, tier, name and description may change at any
 * time. Its processor, interval, price and price ID may not once anyone has
 * subscribed: the processor goes on charging against them, and a plan that
 * said otherwise would no longer be what its subscribers pay for.
 */
export async function updatePlan(input: z.infer<typeof planUpdateSchema>) {
  const { id, ...updates } = input;
  const current = await db.query.plans.findFirst({ where: eq(plans.id, id) });
  if (!current) throw new PublicError('Plan not found');

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.description !== undefined)
    patch.description = updates.description ?? null;
  if (updates.quotaId !== undefined) {
    await requireQuotaExists(updates.quotaId);
    patch.quotaId = updates.quotaId;
  }
  if (updates.tierId !== undefined) {
    if (updates.tierId) await requireTierExists(updates.tierId);
    patch.tierId = updates.tierId ?? null;
  }
  if (updates.displayOrder !== undefined)
    patch.displayOrder = updates.displayOrder;

  // What selling it rests on, as it would be: sent back unchanged is not a
  // change.
  const was: Selling = {
    processor: current.processor,
    interval: current.interval,
    price: priceOf(current.price),
    priceId: current.priceId
  };
  const next: Selling = {
    processor: updates.processor ?? was.processor,
    interval: updates.interval ?? was.interval,
    price: updates.price != null ? priceOf(updates.price) : was.price,
    priceId: updates.priceId ?? was.priceId
  };
  if (!sameSelling(was, next)) {
    if (await planHasSubscriptions(id)) {
      throw new PublicError(
        'This plan has subscriptions, so its payment processor, interval, price and price ID cannot change.'
      );
    }
    Object.assign(patch, next);
  }
  if (!sameSelling(was, next) || updates.name !== undefined) {
    await requireFree({ name: updates.name ?? current.name, ...next }, id);
  }

  await db.update(plans).set(patch).where(eq(plans.id, id));
}

/** Open a plan to new subscriptions, or close it. Closed, those already on
 *  it go on renewing. */
export async function setPlanEnabled(id: string, isEnabled: boolean) {
  const plan = await db.query.plans.findFirst({
    where: eq(plans.id, id),
    columns: { id: true }
  });
  if (!plan) throw new PublicError('Plan not found');
  await db
    .update(plans)
    .set({ isEnabled, updatedAt: new Date() })
    .where(eq(plans.id, id));
}

/** A plan anyone has subscribed to stays; it can be disabled instead. */
export async function deletePlan(id: string) {
  if (await planHasSubscriptions(id)) {
    throw new PublicError(
      'This plan has subscriptions, so it cannot be deleted. Disable it instead.'
    );
  }
  await db.delete(plans).where(eq(plans.id, id));
}
