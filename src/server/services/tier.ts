import '@tanstack/react-start/server-only';

import { asc, count, eq } from 'drizzle-orm';
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
import { plans, tierModels, tiers, users } from '@/db/schema';
import { PublicError } from '@/server/public-error';
import { type Tx } from '@/server/services/db-utils';
import { getDefaultTierId } from '@/server/services/settings';

// ============================================================================
// Reads
// ============================================================================

/** A tier's models as a query reads them along, by modelId. */
const withModelIds = {
  models: {
    columns: { modelId: true as const },
    orderBy: [asc(tierModels.modelId)]
  }
};

/** The models read along, as the list of modelIds the rest go by. */
const modelIdsOf = (models: Array<{ modelId: string }>) =>
  models.map(row => row.modelId);

/** One page of tiers, each with how many plans and users are on it. */
export async function listTiers(page: z.infer<typeof tierListSchema>) {
  const [rows, [totalRow], planCounts, userCounts] = await Promise.all([
    db.query.tiers.findMany({
      ...pageWindow(page),
      with: withModelIds,
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
    rows: rows.map(({ models, ...t }) => ({
      ...t,
      modelIds: modelIdsOf(models),
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
  const tier = await db.query.tiers.findFirst({
    where: eq(tiers.id, id),
    with: withModelIds
  });
  if (!tier) return tier;
  const { models, ...rest } = tier;
  return { ...rest, modelIds: modelIdsOf(models) };
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
        tier: { with: withModelIds },
        plan: { columns: { id: true }, with: { tier: { with: withModelIds } } }
      }
    });

    const inForce = (
      tier: typeof tiers.$inferSelect & { models: Array<{ modelId: string }> },
      source: UserTier['source']
    ): UserTier => ({
      tier: { id: tier.id, name: tier.name },
      priceMultiplier: effectiveMultiplier(tier.priceMultiplier),
      modelRestrictionMode: tier.modelRestrictionMode,
      modelIds: modelIdsOf(tier.models),
      source
    });

    if (row?.tier) return inForce(row.tier, 'override');
    if (row?.plan?.tier) return inForce(row.plan.tier, 'plan');

    const defaultId = await getDefaultTierId();
    if (defaultId) {
      const tier = await db.query.tiers.findFirst({
        where: eq(tiers.id, defaultId),
        with: withModelIds
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
  await db.transaction(async tx => {
    await tx.insert(tiers).values({
      id,
      name: input.name,
      description: input.description ?? null,
      priceMultiplier: input.priceMultiplier,
      modelRestrictionMode: input.modelRestrictionMode
    });
    await insertModels(tx, id, input.modelIds);
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

  await db.transaction(async tx => {
    await tx.update(tiers).set(patch).where(eq(tiers.id, id));
    // Replace the models when a list is supplied; leaving it out keeps them.
    if (updates.modelIds !== undefined) {
      await tx.delete(tierModels).where(eq(tierModels.tierId, id));
      await insertModels(tx, id, updates.modelIds);
    }
  });
}

/** A tier's models, a row each; none to write for an empty list. */
async function insertModels(tx: Tx, tierId: string, modelIds: string[]) {
  if (modelIds.length === 0) return;
  await tx
    .insert(tierModels)
    .values(modelIds.map(modelId => ({ id: generateUUID(), tierId, modelId })));
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
