import { z } from 'zod';

import { paginationSchema } from './pagination';
import { billingIntervalSchema, paymentProcessorSchema } from './payment';

/** The console's plan table, cut to one page. */
export const planListSchema = z.object({ ...paginationSchema.shape });

/** A plan's price: more than nothing, to two decimals. */
export const planPriceSchema = z
  .number()
  .positive('The price must be more than $0.')
  .refine(v => Math.round(v * 100) === v * 100, 'At most two decimals.');

/**
 * What a plan sells for: one price, billed every interval, through the
 * processor it is sold by, with the ID that processor knows the price by.
 */
const sellingShape = {
  processor: paymentProcessorSchema,
  interval: billingIntervalSchema,
  price: planPriceSchema,
  priceId: z.string().trim().min(1).max(255)
};

export const planCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  quotaId: z.string().min(1),
  /** The tier the plan's users are on; none is the cost price and every model. */
  tierId: z.string().min(1).nullable().optional(),
  displayOrder: z.number().int().default(0),
  ...sellingShape
});

/**
 * Every field may change until someone subscribes. After that the
 * processor, interval, price and price ID are what the processor goes on
 * charging against, and the server refuses to change them.
 */
export const planUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  quotaId: z.string().min(1).optional(),
  tierId: z.string().min(1).nullable().optional(),
  displayOrder: z.number().int().optional(),
  processor: sellingShape.processor.optional(),
  interval: sellingShape.interval.optional(),
  price: sellingShape.price.optional(),
  priceId: sellingShape.priceId.optional()
});

export const planIdSchema = z.object({ id: z.string().min(1) });

/** Open or close a plan to new subscriptions. */
export const planEnabledSchema = z.object({
  id: z.string().min(1),
  isEnabled: z.boolean()
});
