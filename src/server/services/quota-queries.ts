import '@tanstack/react-start/server-only';

import { and, eq, gte, sql } from 'drizzle-orm';

import { type ResolvedSource } from '@/types';
import { perRequest } from '@/lib/request-cache';
import { parseNumber } from '@/lib/utils';
import { db } from '@/db';
import { quotas, usage, users } from '@/db/schema';
import { getDefaultQuotaId } from '@/server/services/settings';

type QuotaRow = typeof quotas.$inferSelect;

const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;

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
