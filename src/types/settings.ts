import { z } from 'zod';

/**
 * What the settings server functions accept.
 *
 * Settings are addressed by key rather than id, so a write is an upsert and
 * there is no separate create.
 */
export const settingSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().nullable(),
  description: z.string().max(500).optional()
});

/** A bulk write is the same row shape, several at a time. */
export const settingsBulkSchema = z.array(settingSchema);

export const settingKeySchema = z.object({ key: z.string().min(1) });
