import { z } from 'zod';

import { type ModelRestrictionMode } from '@/lib/model-access';

import { paginationSchema } from './pagination';
import { type ResolvedSource } from './quota';

/** The console's tier table, cut to one page. */
export const tierListSchema = z.object({ ...paginationSchema.shape });

/**
 * A tier's price multiplier as a form sends it: a number, or its text.
 * Required, and above 0: a multiplier of 0 would make every call free, and
 * there is no tier for that.
 */
export const priceMultiplierSchema = z
  .union([z.number(), z.string().trim().min(1, 'Multiplier is required')])
  .transform((v, ctx) => {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n) || n <= 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Multiplier must be a number above 0'
      });
      return z.NEVER;
    }
    return n.toString();
  });

/**
 * What the tier server functions accept. A tier is a name, a price
 * multiplier and a list of models (empty for all); both writes carry the
 * same fields.
 */
export const tierCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  priceMultiplier: priceMultiplierSchema,
  /** How the models are restricted: to the ones listed, or to all but them. */
  modelRestrictionMode: z.enum(['allow', 'deny']).default('allow'),
  modelIds: z.array(z.string()).default([])
});

export const tierUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  priceMultiplier: priceMultiplierSchema.optional(),
  modelRestrictionMode: z.enum(['allow', 'deny']).optional(),
  modelIds: z.array(z.string()).optional()
});

export const tierIdSchema = z.object({ id: z.string().min(1) });

/** Put a user on a tier of their own, or take them off it with null. */
export const userTierSchema = z.object({
  id: z.string().min(1),
  tierId: z.string().min(1).nullable()
});

/**
 * The tier in force for a user, and where it came from: their own, their
 * plan's, the install's default — or none, which is the cost price and
 * every model.
 */
export type UserTier = {
  tier: { id: string; name: string } | null;
  /** The multiplier as applied: 1 when on no tier. */
  priceMultiplier: number;
  /** The models the tier names, and which way it reads them; empty for all. */
  modelRestrictionMode: ModelRestrictionMode;
  modelIds: string[];
  source: ResolvedSource;
};
