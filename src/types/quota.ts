/** Which layer in the resolution chain produced the user's effective quota. */
export type ResolvedSource = 'override' | 'plan' | 'default' | 'none';

/**
 * The quota that applies to a specific user, with current per-window
 * remaining percentage and reset time. Returned by `quota.me` (user) and
 * `quota.getByUser` (admin) — both endpoints get the same shape.
 *
 * Dollar amounts are NEVER exposed: `used` / `limit` are computed only
 * inside `lib/quota.ts` and converted to `remainingPct` before reaching
 * the API surface. The user end can never infer their cap.
 *
 * `fiveHour` / `sevenDay` are present only when the corresponding cap
 * is configured; absent means "no limit for this window".
 */
export type UserQuota = {
  name: string | null;
  isUnlimited: boolean;
  source: ResolvedSource;
  plan: { id: string; name: string } | null;
  fiveHour?: { remainingPct: number; resetAt: Date | null };
  sevenDay?: { remainingPct: number; resetAt: Date | null };
};
