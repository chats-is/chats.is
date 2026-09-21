import { z } from 'zod';

import { isTrustedMediaUrl } from '@/lib/chat-media-urls';

import { paginationSchema } from './pagination';

/**
 * What the user server functions accept. The profile edit comes from the user
 * themselves; the rest act on one user as an admin.
 */
export const profileUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  // A picture the user uploaded here. An account that signed in with Google
  // or GitHub has theirs set by that sign-in, which does not pass through
  // this. Any address at all would be one the console then loads on every
  // admin's screen — a request to a host of the user's choosing, from them.
  image: z
    .url()
    .refine(isTrustedMediaUrl, 'Upload a picture to use as your avatar')
    .optional()
});

/** The console's user table: narrowed by name or email, then cut to one page. */
export const userSearchSchema = z.object({
  search: z.string().optional(),
  ...paginationSchema.shape
});

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
