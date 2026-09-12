import { z } from 'zod';

/**
 * How a page of the library feed is asked for.
 *
 * The cursor is an ISO timestamp; a page never splits a group of items sharing
 * the boundary timestamp, so one can come back slightly longer than `limit`.
 */
export const libraryPageSchema = z.object({
  cursor: z.string().nullish(),
  limit: z.number().min(1).max(60).default(24)
});
