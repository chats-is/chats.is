import '@tanstack/react-start/server-only';

import { count, eq } from 'drizzle-orm';
import { type z } from 'zod';

import { type UserTier } from '@/types';
import { pageWindow } from '@/types/pagination';
import {
  type tierCreateSchema,
  type tierListSchema,
  type tierUpdateSchema
} from '@/types/tier';
import { effectiveMultiplier } from '@/lib/billing';
import { allowsModel } from '@/lib/model-access';
import { perRequest } from '@/lib/request-cache';
import { generateUUID } from '@/lib/utils';
import { db } from '@/db';
import { plans, tiers, users } from '@/db/schema';
import { PublicError } from '@/server/public-error';
import { getDefaultTierId } from '@/server/services/settings';

// ============================================================================
// Reads
// ============================================================================

/** One page of tiers, each with how many plans and users are on it. */
export async function listTiers(page: z.infer<typeof tierListSchema>) {
  const [rows, [totalRow], planCounts, userCounts] = await Promise.all([
    db.query.tiers.findMany({
      ...pageWindow(page),
      // `id` last so the order is total, which offset paging depends on.
      orderBy: (t, { asc }) => [asc(t.name), asc(t.id)]
    }),
    db.select({ count: count() }).from(tiers),
    // Counted across every tier, not just this page: one grouped scan is
    // cheaper than narrowing it to the page's ids.
    db
      .select({ tierId: plans.tierId, count: count() })
      .from(plans)
      .groupBy(plans.tierId),
    db
      .select({ tierId: users.tierId, count: count() })
      .from(users)
      .groupBy(users.tierId)
  ]);

  const byPlan = new Map(planCounts.map(c => [c.tierId, Number(c.count)]));
  const byUser = new Map(userCounts.map(c => [c.tierId, Number(c.count)]));
  return {
    rows: rows.map(t => ({
      ...t,
      planCount: byPlan.get(t.id) ?? 0,
      userCount: byUser.get(t.id) ?? 0
    })),
    total: Number(totalRow?.count ?? 0),
    page: page.page,
    pageSize: page.pageSize
  };
}

/** Every tier, for a selector that offers one. */
export async function listTiersForSelect() {
  return await db.query.tiers.findMany({
    orderBy: (t, { asc }) => [asc(t.name)],
    columns: { id: true, name: true, priceMultiplier: true }
  });
}

/** One tier as the console edits it, read at the moment the form opens. */
export async function getTier(id: string) {
  return await db.query.tiers.findFirst({
    where: eq(tiers.id, id)
  });
}

/**
 * The tier in force for a user, walking the chain a quota does: their own →
 * their plan's → the install's default → none.
 *
 * Read once per request: a turn records several calls — the reply, the
 * title, a search — and they are all charged at the one multiplier.
 */
export const getUserTier = perRequest(
  'getUserTier',
  async (userId: string): Promise<UserTier> => {
    const row = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true },
      with: {
        tier: true,
        plan: { columns: { id: true }, with: { tier: true } }
      }
    });

    const inForce = (
      tier: typeof tiers.$inferSelect,
      source: UserTier['source']
    ): UserTier => ({
      tier: { id: tier.id, name: tier.name },
      priceMultiplier: effectiveMultiplier(tier.priceMultiplier),
      modelRestrictionMode: tier.modelRestrictionMode,
      modelIds: tier.modelIds ?? [],
      source
    });

    if (row?.tier) return inForce(row.tier, 'override');
    if (row?.plan?.tier) return inForce(row.plan.tier, 'plan');

    const defaultId = await getDefaultTierId();
    if (defaultId) {
      const tier = await db.query.tiers.findFirst({
        where: eq(tiers.id, defaultId)
      });
      if (tier) return inForce(tier, 'default');
    }
    return {
      tier: null,
      priceMultiplier: 1,
      modelRestrictionMode: 'allow',
      modelIds: [],
      source: 'none'
    };
  }
);

export class ModelAccessDeniedError extends Error {
  constructor(modelLabel: string) {
    super(`${modelLabel} is not available.`);
    this.name = 'ModelAccessDeniedError';
  }
}

/**
 * Throw if the user's tier does not allow `modelKey` (the modelId string,
 * like "gpt-4o") — see `allowsModel`. Being on no tier allows them all.
 */
export async function assertModelAccess(
  userId: string,
  modelKey: string,
  modelLabelForError: string
): Promise<void> {
  const tier = await getUserTier(userId);
  if (!allowsModel(tier, modelKey)) {
    throw new ModelAccessDeniedError(modelLabelForError);
  }
}

// ============================================================================
// Admin writes
// ============================================================================

export async function createTier(input: z.infer<typeof tierCreateSchema>) {
  const id = generateUUID();
  await db.insert(tiers).values({
    id,
    name: input.name,
    description: input.description ?? null,
    priceMultiplier: input.priceMultiplier,
    modelRestrictionMode: input.modelRestrictionMode,
    modelIds: input.modelIds
  });
  return { id };
}

export async function updateTier(input: z.infer<typeof tierUpdateSchema>) {
  const { id, ...updates } = input;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.description !== undefined)
    patch.description = updates.description ?? null;
  if (updates.priceMultiplier !== undefined)
    patch.priceMultiplier = updates.priceMultiplier;
  if (updates.modelRestrictionMode !== undefined)
    patch.modelRestrictionMode = updates.modelRestrictionMode;
  if (updates.modelIds !== undefined) patch.modelIds = updates.modelIds;

  await db.update(tiers).set(patch).where(eq(tiers.id, id));
}

/**
 * A tier still chosen somewhere cannot go: the plans and users on it would
 * be left pointing at nothing, and the database refuses that anyway. Said
 * here in words, rather than as the constraint's own message.
 */
export async function deleteTier(id: string) {
  if ((await getDefaultTierId()) === id) {
    throw new PublicError(
      'Cannot delete the default tier. Set a different default first.'
    );
  }
  const [[onPlans], [onUsers]] = await Promise.all([
    db.select({ count: count() }).from(plans).where(eq(plans.tierId, id)),
    db.select({ count: count() }).from(users).where(eq(users.tierId, id))
  ]);
  if (Number(onPlans?.count ?? 0) > 0 || Number(onUsers?.count ?? 0) > 0) {
    throw new PublicError(
      'This tier is still used by a plan or a user. Move them off it first.'
    );
  }
  await db.delete(tiers).where(eq(tiers.id, id));
}

/** Admin: put a user on a tier of their own, or take them off it. */
export async function setUserTier(userId: string, tierId: string | null) {
  if (tierId) {
    const exists = await db.query.tiers.findFirst({
      where: eq(tiers.id, tierId)
    });
    if (!exists) throw new PublicError('Tier not found');
  }
  await db
    .update(users)
    .set({ tierId, updatedAt: new Date() })
    .where(eq(users.id, userId));
}
