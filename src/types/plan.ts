import { z } from 'zod';

import { paginationSchema } from './pagination';
import {
  billingTypeSchema,
  intervalsOf,
  paymentProcessorSchema,
  type BillingType
} from './payment';

/** The console's plan table, cut to one page. */
export const planListSchema = z.object({ ...paginationSchema.shape });

/** A plan's price in US dollars: more than nothing, to the cent. */
export const planPriceSchema = z
  .number()
  .positive('The price must be more than $0.')
  .refine(v => Math.round(v * 100) === v * 100, 'At most two decimals.');

const priceIdSchema = z.string().trim().min(1).max(255);

/**
 * What a plan sells for: how it is billed — monthly, yearly or either — the
 * processor it is sold through, and for each interval it is billed at a price
 * of its own with the ID the processor knows it by.
 */
const sellingShape = {
  billingType: billingTypeSchema,
  processor: paymentProcessorSchema,
  monthlyPrice: planPriceSchema.nullable().optional(),
  monthlyPriceId: priceIdSchema.nullable().optional(),
  yearlyPrice: planPriceSchema.nullable().optional(),
  yearlyPriceId: priceIdSchema.nullable().optional()
};

/** Each interval the billing type sells at has its price and price ID. */
export function sellingIssues(plan: {
  billingType?: BillingType | null;
  monthlyPrice?: number | string | null;
  monthlyPriceId?: string | null;
  yearlyPrice?: number | string | null;
  yearlyPriceId?: string | null;
}): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = [];
  for (const interval of intervalsOf(plan.billingType ?? null)) {
    const name = interval === 'month' ? 'monthly' : 'yearly';
    if (plan[`${name}Price`] == null) {
      issues.push({ path: `${name}Price`, message: 'Enter a price' });
    }
    if (!plan[`${name}PriceId`]) {
      issues.push({ path: `${name}PriceId`, message: 'Enter the price ID' });
    }
  }
  return issues;
}

export const planCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500).optional().nullable(),
    quotaId: z.string().min(1),
    /** The tier the plan's users are on; none is the cost price and every model. */
    tierId: z.string().min(1).nullable().optional(),
    displayOrder: z.number().int().default(0),
    ...sellingShape
  })
  .superRefine((plan, ctx) => {
    for (const issue of sellingIssues(plan)) {
      ctx.addIssue({
        code: 'custom',
        path: [issue.path],
        message: issue.message
      });
    }
  });

/**
 * Every field may change until someone subscribes. After that the billing,
 * the prices, the processor and its price IDs are what the processor goes on
 * charging against, and the server refuses to change them. Whether the plan
 * as it ends up is complete is the server's to check, against what it has.
 */
export const planUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  quotaId: z.string().min(1).optional(),
  tierId: z.string().min(1).nullable().optional(),
  displayOrder: z.number().int().optional(),
  billingType: sellingShape.billingType.optional(),
  processor: sellingShape.processor.optional(),
  monthlyPrice: sellingShape.monthlyPrice,
  monthlyPriceId: sellingShape.monthlyPriceId,
  yearlyPrice: sellingShape.yearlyPrice,
  yearlyPriceId: sellingShape.yearlyPriceId
});

export const planIdSchema = z.object({ id: z.string().min(1) });

/** Open or close a plan to new subscriptions. */
export const planEnabledSchema = z.object({
  id: z.string().min(1),
  isEnabled: z.boolean()
});
