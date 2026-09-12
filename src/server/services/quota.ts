import '@tanstack/react-start/server-only';

import { and, eq, gte, sql } from 'drizzle-orm';
import { type z } from 'zod';

import { type ResolvedSource, type UserQuota } from '@/types';
import {
  validateQuotaLimits,
  type quotaCreateSchema,
  type quotaUpdateSchema
} from '@/types/quota';
import { perRequest } from '@/lib/request-cache';
import { generateUUID, parseNumber } from '@/lib/utils';
import { db } from '@/db';
import { quotas, usage, users } from '@/db/schema';
import { PublicError } from '@/server/public-error';
import { getDefaultQuotaId } from '@/server/services/settings';

type QuotaRow = typeof quotas.$inferSelect;

const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;

// ============================================================================
// Reads
// ============================================================================

/**
 * Resolve which quota row applies to a user, walking
 * override → plan → default → none. cache()-wrapped — preflight calls
 * `assertModelAccess` and `assertQuota` back-to-back; cache dedupes the
 * user/plan join to one DB round-trip.
 */
export const getUserResolvedQuota = perRequest(
  'getUserResolvedQuota',
  async (
    userId: string
  ): Promise<{
    quota: QuotaRow | null;
    plan: { id: string; name: string } | null;
    source: ResolvedSource;
  }> => {
    const userRow = await db.query.users.findFirst({
      where: eq(users.id, userId),
      with: {
        quota: true,
        plan: { with: { quota: true } }
      }
    });

    const planInfo = userRow?.plan
      ? { id: userRow.plan.id, name: userRow.plan.name }
      : null;

    if (userRow?.quota) {
      return { quota: userRow.quota, plan: planInfo, source: 'override' };
    }

    if (userRow?.plan?.quota) {
      return { quota: userRow.plan.quota, plan: planInfo, source: 'plan' };
    }

    const defaultId = await getDefaultQuotaId();
    if (defaultId) {
      const defaultQuota = await db.query.quotas.findFirst({
        where: eq(quotas.id, defaultId)
      });
      if (defaultQuota) {
        return { quota: defaultQuota, plan: planInfo, source: 'default' };
      }
    }
    return { quota: null, plan: planInfo, source: 'none' };
  }
);

/**
 * Aggregate cost + reset time for a user's rolling 5h and 7d windows in a
 * single SQL. The reset time = earliest record in the window + window size
 * (when that record ages out, the rolling sum starts dropping).
 */
export async function getUserUsageWindows(userId: string): Promise<{
  fiveHour: { used: number; resetAt: Date | null };
  sevenDay: { used: number; resetAt: Date | null };
}> {
  const now = Date.now();
  const fiveHourSince = new Date(now - FIVE_HOUR_MS);
  const sevenDaySince = new Date(now - SEVEN_DAY_MS);

  const result = await db
    .select({
      sumFiveHour: sql<string>`coalesce(sum(${usage.cost}) filter (where ${usage.createdAt} >= ${fiveHourSince}), 0)`,
      sumSevenDay: sql<string>`coalesce(sum(${usage.cost}), 0)`,
      minFiveHour: sql<Date | null>`min(${usage.createdAt}) filter (where ${usage.createdAt} >= ${fiveHourSince})`,
      minSevenDay: sql<Date | null>`min(${usage.createdAt})`
    })
    .from(usage)
    .where(and(eq(usage.userId, userId), gte(usage.createdAt, sevenDaySince)));

  const r = result[0];
  return {
    fiveHour: {
      used: parseNumber(r?.sumFiveHour) ?? 0,
      resetAt: r?.minFiveHour
        ? new Date(new Date(r.minFiveHour).getTime() + FIVE_HOUR_MS)
        : null
    },
    sevenDay: {
      used: parseNumber(r?.sumSevenDay) ?? 0,
      resetAt: r?.minSevenDay
        ? new Date(new Date(r.minSevenDay).getTime() + SEVEN_DAY_MS)
        : null
    }
  };
}

// ============================================================================
// Rules
// ============================================================================

/**
 * Shape the raw resolved-quota row into the structured form business logic
 * needs: caps + flags + meta. Internal helper; consumers use `getUserQuota`,
 * `assertQuota`, or `assertModelAccess` instead.
 */
async function getResolvedQuota(userId: string): Promise<{
  name: string | null;
  isUnlimited: boolean;
  allowedModelIds: string[];
  fiveHour: number | null;
  sevenDay: number | null;
  source: ResolvedSource;
  plan: { id: string; name: string } | null;
}> {
  const resolved = await getUserResolvedQuota(userId);
  const q = resolved.quota;

  return {
    name: q?.name ?? null,
    isUnlimited: q?.isUnlimited ?? false,
    allowedModelIds: q?.allowedModelIds ?? [],
    fiveHour: parseNumber(q?.fiveHour),
    sevenDay: parseNumber(q?.sevenDay),
    source: resolved.source,
    plan: resolved.plan
  };
}

/**
 * The unified "user's quota" lookup used by both `quota.me` (user-facing)
 * and `quota.getByUser` (admin). Returns no dollar amounts — caps and
 * current usage are computed only inside this function and converted to
 * `remainingPct` before any field leaves the lib layer.
 *
 * Skips the usage query when no caps are configured.
 */
export async function getUserQuota(userId: string): Promise<UserQuota> {
  const resolved = await getResolvedQuota(userId);

  const base = {
    name: resolved.name,
    isUnlimited: resolved.isUnlimited,
    source: resolved.source,
    plan: resolved.plan
  };

  const capFiveHour = resolved.fiveHour;
  const capSevenDay = resolved.sevenDay;
  const hasFiveHour = capFiveHour !== null && capFiveHour > 0;
  const hasSevenDay = capSevenDay !== null && capSevenDay > 0;

  if (!hasFiveHour && !hasSevenDay) return base;

  const data = await getUserUsageWindows(userId);

  const toEntry = (cap: number, used: number, resetAt: Date | null) => ({
    remainingPct: Math.round((Math.max(0, cap - used) / cap) * 100),
    resetAt
  });

  return {
    ...base,
    ...(hasFiveHour && {
      fiveHour: toEntry(capFiveHour, data.fiveHour.used, data.fiveHour.resetAt)
    }),
    ...(hasSevenDay && {
      sevenDay: toEntry(capSevenDay, data.sevenDay.used, data.sevenDay.resetAt)
    })
  };
}

export class QuotaExceededError extends Error {
  public resetAt: Date | null;

  constructor(detail: { resetAt: Date | null }) {
    super('You’ve reached your usage limit. Please try again later.');
    this.name = 'QuotaExceededError';
    this.resetAt = detail.resetAt;
  }
}

export async function assertQuota(userId: string): Promise<void> {
  const resolved = await getResolvedQuota(userId);
  if (resolved.isUnlimited) return;

  const capFiveHour = resolved.fiveHour;
  const capSevenDay = resolved.sevenDay;
  if (capFiveHour === null && capSevenDay === null) return;

  const data = await getUserUsageWindows(userId);

  if (
    capFiveHour !== null &&
    capFiveHour > 0 &&
    data.fiveHour.used >= capFiveHour
  ) {
    throw new QuotaExceededError({ resetAt: data.fiveHour.resetAt });
  }
  if (
    capSevenDay !== null &&
    capSevenDay > 0 &&
    data.sevenDay.used >= capSevenDay
  ) {
    throw new QuotaExceededError({ resetAt: data.sevenDay.resetAt });
  }
}

export class ModelAccessDeniedError extends Error {
  constructor(modelLabel: string) {
    super(`${modelLabel} is not available.`);
    this.name = 'ModelAccessDeniedError';
  }
}

/**
 * Throw if the user's resolved quota does not allow `modelKey`
 * (the modelId string like "gpt-4o"). Empty allowedModelIds means "no restriction".
 */
export async function assertModelAccess(
  userId: string,
  modelKey: string,
  modelLabelForError: string
): Promise<void> {
  const resolved = await getResolvedQuota(userId);
  if (resolved.allowedModelIds.length === 0) return;
  if (!resolved.allowedModelIds.includes(modelKey)) {
    throw new ModelAccessDeniedError(modelLabelForError);
  }
}

// ============================================================================
// Quota CRUD — a quota is an independent entity that users and plans point at
// ============================================================================

/** The admin form sends '' for "no limit"; the column stores null. */
const limitToString = (v: number | null | ''): string | null => {
  if (v === '' || v === null) return null;
  return v.toString();
};

const asNumber = (v: number | null | ''): number | null =>
  v === '' || v === null ? null : v;

/** All quotas, with the system default marked. */
export async function listQuotas() {
  const all = await db.query.quotas.findMany({
    orderBy: (q, { asc }) => [asc(q.name)]
  });
  const defaultQuotaId = await getDefaultQuotaId();
  return all.map(q => ({
    ...q,
    isDefault: q.id === defaultQuotaId
  }));
}

/** The id/name/unlimited triple the console's selectors need. */
export async function listQuotasForSelect() {
  return await db.query.quotas.findMany({
    orderBy: (q, { asc }) => [asc(q.name)],
    columns: { id: true, name: true, isUnlimited: true }
  });
}

export async function createQuota(input: z.infer<typeof quotaCreateSchema>) {
  if (!input.isUnlimited) {
    const w = asNumber(input.sevenDay);
    if (w === null || w <= 0) {
      throw new PublicError(
        'Weekly limit is required and must be positive (or toggle Unlimited).'
      );
    }
    validateQuotaLimits({
      fiveHour: asNumber(input.fiveHour),
      sevenDay: w
    });
  }
  const id = generateUUID();
  await db.insert(quotas).values({
    id,
    name: input.name,
    description: input.description ?? null,
    fiveHour: input.isUnlimited ? null : limitToString(input.fiveHour),
    sevenDay: input.isUnlimited ? null : limitToString(input.sevenDay),
    isUnlimited: input.isUnlimited,
    allowedModelIds: input.allowedModelIds
  });
  return { id };
}

export async function updateQuota(input: z.infer<typeof quotaUpdateSchema>) {
  const { id, ...updates } = input;
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
  if (!existing) throw new PublicError('Quota not found');

  /** The value a field will end up with: the patch when it names one, the
   *  stored value otherwise. */
  const merged = (
    v: number | null | '' | undefined,
    fallback: string | null
  ): number | null => {
    if (v === undefined) {
      if (fallback === null || fallback === '') return null;
      const n = Number(fallback);
      return Number.isFinite(n) ? n : null;
    }
    return asNumber(v);
  };

  const willBeUnlimited =
    updates.isUnlimited !== undefined
      ? updates.isUnlimited
      : existing.isUnlimited;
  if (!willBeUnlimited) {
    const w = merged(updates.sevenDay, existing.sevenDay);
    if (w === null || w <= 0) {
      throw new PublicError(
        'Weekly limit is required and must be positive (or toggle Unlimited).'
      );
    }
    validateQuotaLimits({
      fiveHour: merged(updates.fiveHour, existing.fiveHour),
      sevenDay: w
    });
  } else {
    // Force null the limits whenever Unlimited is on, so stale values
    // don't linger from a previous non-unlimited state.
    patch.fiveHour = null;
    patch.sevenDay = null;
  }

  await db.update(quotas).set(patch).where(eq(quotas.id, id));
}

export async function deleteQuota(id: string) {
  // FK ON DELETE restrict will block deletion if any plan references it.
  // Also block deleting the system default quota.
  const defaultId = await getDefaultQuotaId();
  if (defaultId === id) {
    throw new PublicError(
      'Cannot delete the default quota. Set a different default first.'
    );
  }
  await db.delete(quotas).where(eq(quotas.id, id));
}

/** Admin: pin a user to a specific quota, overriding their plan. */
export async function setUserQuota(userId: string, quotaId: string) {
  const exists = await db.query.quotas.findFirst({
    where: eq(quotas.id, quotaId)
  });
  if (!exists) throw new PublicError('Quota not found');
  await db
    .update(users)
    .set({ quotaId: quotaId, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/** Admin: clear the override; the user falls back to their plan or default. */
export async function removeUserQuota(userId: string) {
  await db
    .update(users)
    .set({ quotaId: null, updatedAt: new Date() })
    .where(eq(users.id, userId));
}
