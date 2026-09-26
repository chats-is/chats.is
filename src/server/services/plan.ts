import '@tanstack/react-start/server-only';

import { count, eq } from 'drizzle-orm';
import { type z } from 'zod';

import { pageWindow } from '@/types/pagination';
import {
  type planCreateSchema,
  type planListSchema,
  type planUpdateSchema
} from '@/types/plan';
import { generateUUID } from '@/lib/utils';
import { db } from '@/db';
import { plans, quotas, tiers, users } from '@/db/schema';
import { PublicError } from '@/server/public-error';

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
  return {
    rows: rows.map(p => ({ ...p, userCount: countMap.get(p.id) ?? 0 })),
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

export async function createPlan(input: z.infer<typeof planCreateSchema>) {
  const id = generateUUID();
  await requireQuotaExists(input.quotaId);
  if (input.tierId) await requireTierExists(input.tierId);

  await db.insert(plans).values({
    id,
    name: input.name,
    description: input.description ?? null,
    quotaId: input.quotaId,
    tierId: input.tierId ?? null,
    displayOrder: input.displayOrder
  });

  return { id };
}

/** One plan as the console edits it, read at the moment the form opens. */
export async function getPlan(id: string) {
  return await db.query.plans.findFirst({
    where: eq(plans.id, id),
    with: { quota: true, tier: true }
  });
}

export async function updatePlan(input: z.infer<typeof planUpdateSchema>) {
  const { id, ...updates } = input;
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

  await db.update(plans).set(patch).where(eq(plans.id, id));
}

export async function deletePlan(id: string) {
  await db.delete(plans).where(eq(plans.id, id));
}
