import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { generateUUID } from '@/lib/utils';
import { db } from '@/server/db';
import { plans, quotas, users } from '@/server/db/schema';
import { adminMiddleware } from '@/server/middleware';

/**
 * Public list (used by clients to display tier info in /settings/usage).
 */
/**
 * Public list of plans — id / name / description / displayOrder only.
 * Deliberately omits the linked quota row to avoid leaking quota dollar
 * amounts to the user end.
 */
export const listPublicPlans = createServerFn({ method: 'GET' }).handler(
  async () => {
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
);

/**
 * Admin list — also returns user count per plan.
 */
export const listPlans = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(async () => {
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
  });

export const createPlan = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional().nullable(),
      quotaId: z.string().min(1),
      displayOrder: z.number().int().default(0)
    })
  )
  .handler(async ({ data }) => {
    const id = generateUUID();
    // Verify quota exists
    const quota = await db.query.quotas.findFirst({
      where: eq(quotas.id, data.quotaId)
    });
    if (!quota) throw new Error('Quota not found');

    await db.insert(plans).values({
      id,
      name: data.name,
      description: data.description ?? null,
      quotaId: data.quotaId,
      displayOrder: data.displayOrder
    });

    return { id };
  });

export const updatePlan = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional().nullable(),
      quotaId: z.string().min(1).optional(),
      displayOrder: z.number().int().optional()
    })
  )
  .handler(async ({ data }) => {
    const { id, ...updates } = data;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.description !== undefined)
      patch.description = updates.description ?? null;
    if (updates.quotaId !== undefined) {
      const quota = await db.query.quotas.findFirst({
        where: eq(quotas.id, updates.quotaId)
      });
      if (!quota) throw new Error('Quota not found');
      patch.quotaId = updates.quotaId;
    }
    if (updates.displayOrder !== undefined)
      patch.displayOrder = updates.displayOrder;

    await db.update(plans).set(patch).where(eq(plans.id, id));
  });

export const deletePlan = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await db.delete(plans).where(eq(plans.id, data.id));
  });

export const planQueries = {
  all: () => ['plan'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    listPublic: () => ['plan', 'listPublic'] as const,
    list: () => ['plan', 'list'] as const
  },
  listPublic: () =>
    queryOptions({
      queryKey: [...planQueries.key.listPublic()] as const,
      queryFn: () => listPublicPlans()
    }),
  list: () =>
    queryOptions({
      queryKey: [...planQueries.key.list()] as const,
      queryFn: () => listPlans()
    })
};
