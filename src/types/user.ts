import { z } from 'zod';

/**
 * What the user server functions accept. The profile edit comes from the user
 * themselves; the rest act on one user as an admin.
 */
export const profileUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  image: z.url().optional()
});

export const userSearchSchema = z.object({ search: z.string().optional() });

export const userIdSchema = z.object({ id: z.string() });

/** Pass planId=null to clear it; the user falls back to the default. */
export const userPlanSchema = z.object({
  id: z.string().min(1),
  planId: z.string().nullable()
});

export const userRoleSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'admin'])
});
