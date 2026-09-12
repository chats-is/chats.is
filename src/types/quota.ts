import { z } from 'zod';

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

/**
 * What the quota server functions accept.
 *
 * The admin form sends '' for "no limit", which means the same as null; only
 * this layer needs to know that.
 */
const quotaLimitSchema = z
  .union([z.number().positive(), z.literal('')])
  .nullable();

export const quotaCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  fiveHour: quotaLimitSchema.default(null),
  sevenDay: quotaLimitSchema.default(null),
  isUnlimited: z.boolean().default(false),
  allowedModelIds: z.array(z.string()).default([])
});

export const quotaUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  fiveHour: quotaLimitSchema.optional(),
  sevenDay: quotaLimitSchema.optional(),
  isUnlimited: z.boolean().optional(),
  allowedModelIds: z.array(z.string()).optional()
});

export const quotaIdSchema = z.object({ id: z.string().min(1) });
export const quotaUserSchema = z.object({ userId: z.string().min(1) });
export const quotaAssignSchema = z.object({
  userId: z.string().min(1),
  quotaId: z.string().min(1)
});

/**
 * The 5-hour cap may not exceed a quarter of the weekly one. A cross-field
 * rule, so it cannot be a field's own schema, but it is the same kind of
 * thing — a rule about the input with nothing of the server in it.
 *
 * Throws a plain Error: the client surfaces `.message` directly.
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
