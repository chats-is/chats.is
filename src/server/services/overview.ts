import '@tanstack/react-start/server-only';

import { adminRevenue } from '@/server/services/revenue';
import { activeUsers, adminUsageStats } from '@/server/services/usage';
import { userSummary } from '@/server/services/user';

/**
 * The console's home from `since` to `until`: its users and those of them
 * who called a model, its usage as the Usage page shows it, and its money,
 * each as its own service reckons them — by the day, or by the hour over a
 * window of one day (`step`).
 */
export async function adminOverview(since: Date, until?: Date, step?: number) {
  const [users, active, usage, revenue] = await Promise.all([
    userSummary(since, until, step),
    activeUsers(since, until, step),
    adminUsageStats(since, until, undefined, step),
    adminRevenue(since, until, step)
  ]);
  return { users, active, usage, revenue };
}
