import '@tanstack/react-start/server-only';

import { type ResolvedSource, type UserQuota } from '@/types';
import { getUserResolvedQuota, getUserUsageWindows } from '@/lib/queries';
import { parseNumber } from '@/lib/utils';

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

/**
 * Validate that an admin-supplied set of quota limits is internally consistent.
 *
 *   Upper-bound ratio: `fiveHour ≤ sevenDay × 0.25`. When `sevenDay ≥ 0` this
 *   also implies ordering (`fiveHour ≤ sevenDay`).
 *
 * Note: throws a plain Error — the tRPC layer surfaces `.message` directly
 * via `toast.error(e.message)` in the client.
 */
export function validateQuotaLimits(input: {
  fiveHour: number | null;
  sevenDay: number | null;
}): void {
  const { fiveHour: h, sevenDay: w } = input;
  const fmt = (n: number) => `$${n.toFixed(2)}`;

  if (h != null && w != null && h > w * 0.25) {
    throw new Error(
      `5-hour limit (${fmt(h)}) is too large relative to weekly (${fmt(w)}). ` +
        `Maximum allowed is ${fmt(w * 0.25)} (25% of weekly).`
    );
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
