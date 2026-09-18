import { createServerFn } from '@tanstack/react-start';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { type z } from 'zod';

import { DEFAULT_PAGE_SIZE } from '@/types/pagination';
import {
  pricingIdSchema,
  pricingListSchema,
  pricingUpsertSchema,
  remoteSearchSchema,
  syncRunSchema,
  syncTargetSchema
} from '@/types/pricing';
import { adminMiddleware } from '@/server/middleware';
import * as pricing from '@/server/services/pricing';
import * as pricingSync from '@/server/services/pricing-sync';

/** How a caller may narrow the pricing table; all optional here because the
 *  query key is built before the schema's defaults apply. */
type PricingListInput = Partial<z.input<typeof pricingListSchema>>;

export const listPricingWithModels = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(pricingListSchema)
  .handler(({ data }) => pricing.listPricingWithModels(data));

export const upsertPricing = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(pricingUpsertSchema)
  .handler(({ data }) => pricing.upsertPricing(data));

export const deletePricing = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(pricingIdSchema)
  .handler(({ data }) => pricing.deletePricing(data.id));

/** What would change if we synced pricing from a remote source. */
export const previewPricingSync = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(syncTargetSchema)
  .handler(({ data }) => pricingSync.previewPricingSync(data));

/**
 * Sync pricing from a remote source. Omitting modelDbIds syncs every model;
 * onlyMissing skips the ones that already have pricing.
 */
export const runPricingSync = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(syncRunSchema)
  .handler(({ data }) => pricingSync.runPricingSync(data));

/** Free-text search of the remote catalogue, for the admin autocomplete. */
export const searchRemotePricing = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(remoteSearchSchema)
  .handler(({ data }) => pricingSync.searchRemotePricing(data));

export const pricingQueries = {
  all: () => ['pricing'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    listWithModels: () => ['pricing', 'listWithModels'] as const,
    searchRemote: () => ['pricing', 'searchRemote'] as const
  },
  /** One page of the console's pricing table. */
  listWithModels: (input: PricingListInput = {}) =>
    queryOptions({
      queryKey: [...pricingQueries.key.listWithModels(), input] as const,
      queryFn: () =>
        listPricingWithModels({
          data: { page: 1, pageSize: DEFAULT_PAGE_SIZE, ...input }
        }),
      // Paging changes the key, so without this every page turn would read as
      // a first load and blank the table. The previous page stays on screen
      // until the next one lands.
      placeholderData: keepPreviousData
    }),
  /** Reads the upstream catalogue, so it is only fetched when asked for. */
  searchRemote: (input: {
    source: 'models.dev' | 'llm-metadata';
    query?: string;
    limit?: number;
  }) =>
    queryOptions({
      queryKey: [...pricingQueries.key.searchRemote(), input] as const,
      queryFn: () => searchRemotePricing({ data: { limit: 50, ...input } })
    })
};
