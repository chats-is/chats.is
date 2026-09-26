import { createServerFn } from '@tanstack/react-start';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { DEFAULT_PAGE_SIZE } from '@/types/pagination';
import {
  tierCreateSchema,
  tierIdSchema,
  tierListSchema,
  tierUpdateSchema,
  userTierSchema
} from '@/types/tier';
import { adminMiddleware } from '@/server/middleware';
import * as tiers from '@/server/services/tier';

/** Admin list — one page, and how many plans and users are on each tier. */
export const listTiers = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(tierListSchema)
  .handler(({ data }) => tiers.listTiers(data));

export const listTiersForSelect = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(() => tiers.listTiersForSelect());

/** One tier, for the edit form. */
export const getTier = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(tierIdSchema)
  .handler(({ data }) => tiers.getTier(data.id));

export const createTier = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(tierCreateSchema)
  .handler(({ data }) => tiers.createTier(data));

export const updateTier = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(tierUpdateSchema)
  .handler(({ data }) => tiers.updateTier(data));

export const deleteTier = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(tierIdSchema)
  .handler(({ data }) => tiers.deleteTier(data.id));

/** Admin: put a user on a tier of their own, or take them off it with null. */
export const setUserTier = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(userTierSchema)
  .handler(({ data }) => tiers.setUserTier(data.id, data.tierId));

export const tierQueries = {
  all: () => ['tier'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    list: () => ['tier', 'list'] as const,
    listForSelect: () => ['tier', 'listForSelect'] as const
  },
  /** One page of the console's tier table. */
  list: (input: { page?: number; pageSize?: number } = {}) =>
    queryOptions({
      queryKey: [...tierQueries.key.list(), input] as const,
      queryFn: () =>
        listTiers({ data: { page: 1, pageSize: DEFAULT_PAGE_SIZE, ...input } }),
      // Paging changes the key, so without this every page turn would read as
      // a first load and blank the table. The previous page stays on screen
      // until the next one lands.
      placeholderData: keepPreviousData
    }),
  /** Every tier, for a selector that offers one. */
  listForSelect: () =>
    queryOptions({
      queryKey: [...tierQueries.key.listForSelect()] as const,
      queryFn: () => listTiersForSelect()
    })
};
