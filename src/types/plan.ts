import { z } from 'zod';

import { paginationSchema } from './pagination';

/** The console's plan table, cut to one page. */
export const planListSchema = z.object({ ...paginationSchema.shape });

/**
 * What the plan server functions accept. A plan is a name and the quota
 * behind it; both writes carry the same fields.
 */
export const planCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  quotaId: z.string().min(1),
  displayOrder: z.number().int().default(0)
});

export const planUpdateSchema = z.object({
  /** The `updatedAt` the edit form was opened on. Named by a form so that a
   *  save over someone else's change is refused; see `stale-edit`. */
  expectedUpdatedAt: z.coerce.date().optional(),
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  quotaId: z.string().min(1).optional(),
  displayOrder: z.number().int().optional()
});

export const planIdSchema = z.object({ id: z.string().min(1) });
