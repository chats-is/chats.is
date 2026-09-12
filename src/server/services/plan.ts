import '@tanstack/react-start/server-only';

import { eq, sql } from 'drizzle-orm';
import { type z } from 'zod';

import { type planCreateSchema, type planUpdateSchema } from '@/types/plan';
import { generateUUID } from '@/lib/utils';
import { db } from '@/db';
import { plans, quotas, users } from '@/db/schema';
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

/** Plans with their quota and how many users are on each. */
export async function listPlans() {
  const all = await db.query.plans.findMany({
    orderBy: (p, { asc }) => [asc(p.displayOrder), asc(p.name)],
    with: { quota: true }
  });

  const counts = await db
    .select({
      planId: users.planId,
      count: sql<number>`count(*)`
    })
    .from(users)
    .groupBy(users.planId);

  const countMap = new Map(counts.map(c => [c.planId, Number(c.count)]));
  return all.map(p => ({
    ...p,
    userCount: countMap.get(p.id) ?? 0
  }));
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

  await db.insert(plans).values({
    id,
    name: input.name,
    description: input.description ?? null,
    quotaId: input.quotaId,
    displayOrder: input.displayOrder
  });

  return { id };
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
  if (updates.displayOrder !== undefined)
    patch.displayOrder = updates.displayOrder;

  await db.update(plans).set(patch).where(eq(plans.id, id));
}

export async function deletePlan(id: string) {
  await db.delete(plans).where(eq(plans.id, id));
}
