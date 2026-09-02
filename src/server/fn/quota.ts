import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { getDefaultQuotaId } from '@/lib/queries';
import { getUserQuota, validateQuotaLimits } from '@/lib/quota';
import { generateUUID } from '@/lib/utils';
import { db } from '@/server/db';
import { quotas, users } from '@/server/db/schema';
import { adminMiddleware, authedMiddleware } from '@/server/middleware';

const limitSchema = z.union([z.number().positive(), z.literal('')]).nullable();
const limitToString = (v: number | null | ''): string | null => {
  if (v === '' || v === null) return null;
  return v.toString();
};

// ===========================================================================
// Quota CRUD (independent entity)
// ===========================================================================

/**
 * List all quotas (admin). Marks the system default.
 */
export const listQuotas = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(async () => {
    const all = await db.query.quotas.findMany({
      orderBy: (q, { asc }) => [asc(q.name)]
    });
    const defaultQuotaId = await getDefaultQuotaId();
    return all.map(q => ({
      ...q,
      isDefault: q.id === defaultQuotaId
    }));
  });

/**
 * Listing used by selectors (public-ish, but kept admin for now).
 */
export const listQuotasForSelect = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(async () => {
    return await db.query.quotas.findMany({
      orderBy: (q, { asc }) => [asc(q.name)],
      columns: { id: true, name: true, isUnlimited: true }
    });
  });

export const createQuota = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional().nullable(),
      fiveHour: limitSchema.default(null),
      sevenDay: limitSchema.default(null),
      isUnlimited: z.boolean().default(false),
      allowedModelIds: z.array(z.string()).default([])
    })
  )
  .handler(async ({ data }) => {
    const num = (v: number | null | ''): number | null =>
      v === '' || v === null ? null : v;
    if (!data.isUnlimited) {
      const w = num(data.sevenDay);
      if (w === null || w <= 0) {
        throw new Error(
          'Weekly limit is required and must be positive (or toggle Unlimited).'
        );
      }
      validateQuotaLimits({
        fiveHour: num(data.fiveHour),
        sevenDay: w
      });
    }
    const id = generateUUID();
    await db.insert(quotas).values({
      id,
      name: data.name,
      description: data.description ?? null,
      fiveHour: data.isUnlimited ? null : limitToString(data.fiveHour),
      sevenDay: data.isUnlimited ? null : limitToString(data.sevenDay),
      isUnlimited: data.isUnlimited,
      allowedModelIds: data.allowedModelIds
    });
    return { id };
  });

export const updateQuota = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional().nullable(),
      fiveHour: limitSchema.optional(),
      sevenDay: limitSchema.optional(),
      isUnlimited: z.boolean().optional(),
      allowedModelIds: z.array(z.string()).optional()
    })
  )
  .handler(async ({ data }) => {
    const { id, ...updates } = data;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.description !== undefined)
      patch.description = updates.description ?? null;
    if (updates.fiveHour !== undefined)
      patch.fiveHour = limitToString(updates.fiveHour);
    if (updates.sevenDay !== undefined)
      patch.sevenDay = limitToString(updates.sevenDay);
    if (updates.isUnlimited !== undefined)
      patch.isUnlimited = updates.isUnlimited;
    if (updates.allowedModelIds !== undefined)
      patch.allowedModelIds = updates.allowedModelIds;

    // Validate the resulting limits state (existing values merged with patch).
    const existing = await db.query.quotas.findFirst({
      where: eq(quotas.id, id)
    });
    if (!existing) throw new Error('Quota not found');
    const num = (
      v: number | null | '' | undefined,
      fallback: string | null
    ): number | null => {
      if (v === undefined) {
        if (fallback === null || fallback === '') return null;
        const n = Number(fallback);
        return Number.isFinite(n) ? n : null;
      }
      if (v === '' || v === null) return null;
      return v;
    };
    const willBeUnlimited =
      updates.isUnlimited !== undefined
        ? updates.isUnlimited
        : existing.isUnlimited;
    if (!willBeUnlimited) {
      const w = num(updates.sevenDay, existing.sevenDay);
      if (w === null || w <= 0) {
        throw new Error(
          'Weekly limit is required and must be positive (or toggle Unlimited).'
        );
      }
      validateQuotaLimits({
        fiveHour: num(updates.fiveHour, existing.fiveHour),
        sevenDay: w
      });
    } else {
      // Force null the limits whenever Unlimited is on, so stale values
      // don't linger from a previous non-unlimited state.
      patch.fiveHour = null;
      patch.sevenDay = null;
    }

    await db.update(quotas).set(patch).where(eq(quotas.id, id));
  });

export const deleteQuota = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    // FK ON DELETE restrict will block deletion if any plan references it.
    // Also block deleting the system default quota.
    const defaultId = await getDefaultQuotaId();
    if (defaultId === data.id) {
      throw new Error(
        'Cannot delete the default quota. Set a different default first.'
      );
    }
    await db.delete(quotas).where(eq(quotas.id, data.id));
  });

// ===========================================================================
// Per-user view & overrides
// ===========================================================================

/** Current user's quota — same shape as `getByUser`, no dollar amounts. */
export const getMyQuota = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .handler(async ({ context }) => {
    return await getUserQuota(context.user.id);
  });

/** Admin: any user's quota (same shape as `me`). */
export const getQuotaForUser = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(z.object({ userId: z.string().min(1) }))
  .handler(async ({ data }) => {
    return await getUserQuota(data.userId);
  });

/**
 * Admin: assign a quota override to a user.
 */
export const setUserQuota = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      userId: z.string().min(1),
      quotaId: z.string().min(1)
    })
  )
  .handler(async ({ data }) => {
    const exists = await db.query.quotas.findFirst({
      where: eq(quotas.id, data.quotaId)
    });
    if (!exists) throw new Error('Quota not found');
    await db
      .update(users)
      .set({ quotaId: data.quotaId, updatedAt: new Date() })
      .where(eq(users.id, data.userId));
  });

/**
 * Admin: clear a user's override; user falls back to their plan or default.
 */
export const removeUserQuota = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(z.object({ userId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await db
      .update(users)
      .set({ quotaId: null, updatedAt: new Date() })
      .where(eq(users.id, data.userId));
  });

export const quotaQueries = {
  all: () => ['quota'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    list: () => ['quota', 'list'] as const,
    listForSelect: () => ['quota', 'listForSelect'] as const,
    me: () => ['quota', 'me'] as const,
    byUser: () => ['quota', 'byUser'] as const
  },
  list: () =>
    queryOptions({
      queryKey: [...quotaQueries.key.list()] as const,
      queryFn: () => listQuotas()
    }),
  listForSelect: () =>
    queryOptions({
      queryKey: [...quotaQueries.key.listForSelect()] as const,
      queryFn: () => listQuotasForSelect()
    }),
  me: () =>
    queryOptions({
      queryKey: [...quotaQueries.key.me()] as const,
      queryFn: () => getMyQuota()
    }),
  byUser: (input: { userId: string }) =>
    queryOptions({
      queryKey: [...quotaQueries.key.byUser(), input] as const,
      queryFn: () => getQuotaForUser({ data: input })
    })
};
