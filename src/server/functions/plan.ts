import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';

import { planCreateSchema, planIdSchema, planUpdateSchema } from '@/types/plan';
import { adminMiddleware } from '@/server/middleware';
import * as plans from '@/server/services/plan';

/** Public list — no quota amounts. */
export const listPublicPlans = createServerFn({ method: 'GET' }).handler(() =>
  plans.listPublicPlans()
);

/** Admin list — also returns user count per plan. */
export const listPlans = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(() => plans.listPlans());

export const createPlan = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(planCreateSchema)
  .handler(({ data }) => plans.createPlan(data));

export const updatePlan = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(planUpdateSchema)
  .handler(({ data }) => plans.updatePlan(data));

export const deletePlan = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(planIdSchema)
  .handler(({ data }) => plans.deletePlan(data.id));

export const planQueries = {
  all: () => ['plan'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    listPublic: () => ['plan', 'listPublic'] as const,
    list: () => ['plan', 'list'] as const
  },
  listPublic: () =>
    queryOptions({
      queryKey: [...planQueries.key.listPublic()] as const,
      queryFn: () => listPublicPlans()
    }),
  list: () =>
    queryOptions({
      queryKey: [...planQueries.key.list()] as const,
      queryFn: () => listPlans()
    })
};
