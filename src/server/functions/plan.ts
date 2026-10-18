import { createServerFn } from '@tanstack/react-start';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { processorPriceLookupSchema } from '@/types/payment';
import {
  planCreateSchema,
  planEnabledSchema,
  planIdSchema,
  planListSchema,
  planUpdateSchema
} from '@/types/plan';
import { DEFAULT_PAGE_SIZE } from '@/lib/constant';
import { adminMiddleware } from '@/server/middleware';
import * as plans from '@/server/services/plan';
import { lookupProcessorPrice } from '@/server/services/subscription';

/** Admin list — one page, and the user count per plan. */
export const listPlans = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(planListSchema)
  .handler(({ data }) => plans.listPlans(data));

/** One plan, for the edit form. */
export const getPlan = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(planIdSchema)
  .handler(({ data }) => plans.getPlan(data.id));

export const createPlan = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(planCreateSchema)
  .handler(({ data }) => plans.createPlan(data));

export const updatePlan = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(planUpdateSchema)
  .handler(({ data }) => plans.updatePlan(data));

/** Open a plan to new subscriptions, or close it. */
export const setPlanEnabled = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(planEnabledSchema)
  .handler(({ data }) => plans.setPlanEnabled(data.id, data.isEnabled));

/** A processor's price, read for the plan form to offer its amount. */
export const lookupPlanPrice = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(processorPriceLookupSchema)
  .handler(({ data }) => lookupProcessorPrice(data.processor, data.priceId));

export const deletePlan = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(planIdSchema)
  .handler(({ data }) => plans.deletePlan(data.id));

export const planQueries = {
  all: () => ['plan'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    list: () => ['plan', 'list'] as const
  },
  /** One page of the console's plan table. */
  list: (input: { page?: number; pageSize?: number } = {}) =>
    queryOptions({
      queryKey: [...planQueries.key.list(), input] as const,
      queryFn: () =>
        listPlans({ data: { page: 1, pageSize: DEFAULT_PAGE_SIZE, ...input } }),
      // Paging changes the key, so without this every page turn would read as
      // a first load and blank the table. The previous page stays on screen
      // until the next one lands.
      placeholderData: keepPreviousData
    })
};
