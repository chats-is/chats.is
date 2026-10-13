import '@tanstack/react-start/server-only';

import { adminRevenue } from '@/server/services/revenue';
import { activeUsers, adminUsageStats } from '@/server/services/usage';
import { userSummary } from '@/server/services/user';

/**
 * The console's home from `since` to `until`: its users and those of them
 * who called a model, its usage as the Usage page shows it, and its money,
 * each as its own service reckons them.
 */
export async function adminOverview(since: Date, until?: Date) {
  const [users, active, usage, revenue] = await Promise.all([
    userSummary(since, until),
    activeUsers(since, until),
    adminUsageStats(since, until),
    adminRevenue(since, until)
  ]);
  return { users, active, usage, revenue };
}
