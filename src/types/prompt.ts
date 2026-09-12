import { z } from 'zod';

const promptLabelsSchema = z.array(z.string()).nullable().optional();
const promptVisibilitySchema = z.enum(['private', 'public']);

/**
 * What the prompt server functions accept.
 *
 * The same two write shapes serve a user's own prompts and the admin gallery;
 * which of the two a caller may use is decided by the middleware, not here.
 */
export const promptCreateSchema = z.object({
  name: z.string().min(1).max(100),
  content: z.string().min(1),
  image: z.string().max(500).nullable().optional(),
  tags: promptLabelsSchema,
  providers: promptLabelsSchema,
  models: promptLabelsSchema,
  visibility: promptVisibilitySchema.optional(),
  displayOrder: z.number().int().default(0)
});

export const promptUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  content: z.string().min(1).optional(),
  image: z.string().max(500).nullable().optional(),
  tags: promptLabelsSchema,
  providers: promptLabelsSchema,
  models: promptLabelsSchema,
  visibility: promptVisibilitySchema.optional(),
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
    cursor: z.number().min(0).nullish()
  })
  .optional();
