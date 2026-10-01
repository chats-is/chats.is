import '@tanstack/react-start/server-only';

import { and, count, eq, inArray, ne, or } from 'drizzle-orm';
import { type z } from 'zod';

import { pageWindow } from '@/types/pagination';
import {
  intervalsOf,
  type BillingType,
  type PaymentProcessorId
} from '@/types/payment';
import {
  sellingIssues,
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

/**
 * Plans as the user end may see them: id, name, description, order.
 *
 * Deliberately omits the linked quota row — the dollar amounts in it are not
 * for the user end.
 */
export async function listPublicPlans() {
  return await db.query.plans.findMany({
    columns: {
      id: true,
      name: true,
      description: true,
      displayOrder: true,
      createdAt: true,
      updatedAt: true
    },
    orderBy: (p, { asc }) => [asc(p.displayOrder), asc(p.name)]
  });
}

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
      // Subscribed to: its billing, prices, processor and price IDs are fixed.
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
  billingType: BillingType | null;
  processor: PaymentProcessorId | null;
  monthlyPrice: string | null;
  monthlyPriceId: string | null;
  yearlyPrice: string | null;
  yearlyPriceId: string | null;
};

/** Selling fields as stored: an interval the billing type does not sell at
 *  keeps no price, and prices are kept to the cent. */
function normalized(input: {
  billingType?: BillingType | null;
  processor?: PaymentProcessorId | null;
  monthlyPrice?: number | string | null;
  monthlyPriceId?: string | null;
  yearlyPrice?: number | string | null;
  yearlyPriceId?: string | null;
}): Selling {
  const intervals = intervalsOf(input.billingType ?? null);
  const price = (v: number | string | null | undefined) =>
    v == null ? null : Number(v).toFixed(2);
  const monthly = intervals.includes('month');
  const yearly = intervals.includes('year');
  return {
    billingType: input.billingType ?? null,
    processor: input.processor ?? null,
    monthlyPrice: monthly ? price(input.monthlyPrice) : null,
    monthlyPriceId: monthly ? (input.monthlyPriceId ?? null) : null,
    yearlyPrice: yearly ? price(input.yearlyPrice) : null,
    yearlyPriceId: yearly ? (input.yearlyPriceId ?? null) : null
  };
}

const sameSelling = (a: Selling, b: Selling) =>
  (Object.keys(a) as Array<keyof Selling>).every(key => a[key] === b[key]);

/**
 * A processor's price names one plan and interval, so a webhook can tell
 * which: not another plan's, at either interval, and not the plan's own
 * other interval.
 */
async function requirePriceIdsFree(selling: Selling, planId?: string) {
  const ids = [selling.monthlyPriceId, selling.yearlyPriceId].filter(
    (id): id is string => !!id
  );
  if (ids.length === 2 && ids[0] === ids[1]) {
    throw new PublicError('The monthly and yearly price IDs must differ.');
  }
  if (!selling.processor || ids.length === 0) return;
  const other = await db.query.plans.findFirst({
    where: and(
      eq(plans.processor, selling.processor),
      or(inArray(plans.monthlyPriceId, ids), inArray(plans.yearlyPriceId, ids)),
      planId ? ne(plans.id, planId) : undefined
    ),
    columns: { name: true }
  });
  if (other) {
    throw new PublicError(`Plan ${other.name} already uses this price ID.`);
  }
}

export async function createPlan(input: z.infer<typeof planCreateSchema>) {
  const id = generateUUID();
  await requireQuotaExists(input.quotaId);
  if (input.tierId) await requireTierExists(input.tierId);
  const selling = normalized(input);
  await requirePriceIdsFree(selling);

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
 * time. How it is billed, its prices, its processor and price IDs may not
 * once anyone has subscribed: the processor goes on charging against them, and a
 * plan that said otherwise would no longer be what its subscribers pay for.
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
  const was = normalized(current);
  const next = normalized({
    billingType: updates.billingType ?? current.billingType,
    processor: updates.processor ?? current.processor,
    monthlyPrice:
      updates.monthlyPrice !== undefined
        ? updates.monthlyPrice
        : current.monthlyPrice,
    monthlyPriceId:
      updates.monthlyPriceId !== undefined
        ? updates.monthlyPriceId
        : current.monthlyPriceId,
    yearlyPrice:
      updates.yearlyPrice !== undefined
        ? updates.yearlyPrice
        : current.yearlyPrice,
    yearlyPriceId:
      updates.yearlyPriceId !== undefined
        ? updates.yearlyPriceId
        : current.yearlyPriceId
  });
  if (!sameSelling(was, next)) {
    if (await planHasSubscriptions(id)) {
      throw new PublicError(
        'This plan has subscriptions, so its billing, prices, payment processor and price IDs cannot change.'
      );
    }
    const issue = sellingIssues(next)[0];
    if (issue) throw new PublicError(issue.message);
    await requirePriceIdsFree(next, id);
    Object.assign(patch, next);
  }

  await db.update(plans).set(patch).where(eq(plans.id, id));
}

/** Open a plan to new subscriptions, or close it. Closed, those already on
 *  it go on renewing. Only a plan with its prices can open. */
export async function setPlanEnabled(id: string, isEnabled: boolean) {
  const plan = await db.query.plans.findFirst({ where: eq(plans.id, id) });
  if (!plan) throw new PublicError('Plan not found');
  if (
    isEnabled &&
    (!plan.billingType || !plan.processor || sellingIssues(plan).length > 0)
  ) {
    throw new PublicError(
      'Give this plan its billing, payment processor, prices and price IDs first.'
    );
  }
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
