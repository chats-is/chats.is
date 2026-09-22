import { z } from 'zod';

import { paginationSchema } from './pagination';

/** The console's prompt table: narrowed, then cut to one page. */
export const promptListSchema = z.object({
  /** Matches a prompt's name or its content. */
  search: z.string().max(200).optional(),
  ...paginationSchema.shape
});

const promptLabelsSchema = z.array(z.string()).nullable().optional();

/**
 * What the prompt server functions accept.
 *
 * The same two write shapes serve a user's own prompts and the admin gallery;
 * which of the two a caller may use is decided by the middleware, not here.
 *
 * Neither carries `visibility`. Where a prompt is written from decides it — the
 * console writes public ones, a user writes private ones — so it is not a field
 * a client can set, and there is nothing for either form to offer.
 */
export const promptCreateSchema = z.object({
  name: z.string().min(1).max(100),
  content: z.string().min(1),
  image: z.string().max(500).nullable().optional(),
  tags: promptLabelsSchema,
  providers: promptLabelsSchema,
  models: promptLabelsSchema,
  displayOrder: z.number().int().default(0)
});

export const promptUpdateSchema = z.object({
  /** The `updatedAt` the edit form was opened on. Named by a form so that a
   *  save over someone else's change is refused; see `stale-edit`. */
  expectedUpdatedAt: z.coerce.date().optional(),
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  content: z.string().min(1).optional(),
  image: z.string().max(500).nullable().optional(),
  tags: promptLabelsSchema,
  providers: promptLabelsSchema,
  models: promptLabelsSchema,
  displayOrder: z.number().int().optional()
});

export const promptIdSchema = z.object({ id: z.string().min(1) });

/**
 * Paged for the gallery, whole for the composer's suggestions: without a
 * limit this returns everything, which is what a handful is picked from.
 */
export const promptPageSchema = z
  .object({
    limit: z.number().min(1).max(100).optional(),
    cursor: z.number().min(0).nullish(),
    search: z.string().max(200).optional()
  })
  .optional();
