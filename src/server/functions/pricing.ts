import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';

import {
  pricingIdSchema,
  pricingListSchema,
  pricingUpsertSchema,
  remoteSearchSchema,
  syncRunSchema,
  syncTargetSchema
} from '@/types/pricing';
import { adminMiddleware } from '@/server/middleware';
import {
  deletePricing as deletePricingRow,
  listModelsWithPricing,
  upsertModelPricing
} from '@/server/services/pricing';
import {
  previewSync,
  searchRemotePricing as searchPricingCatalog,
  syncPricing
} from '@/server/services/pricing-sync';

export const listPricingWithModels = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(pricingListSchema)
  .handler(({ data }) => listModelsWithPricing(data));

export const upsertPricing = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(pricingUpsertSchema)
  .handler(({ data }) => upsertModelPricing(data));

export const deletePricing = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(pricingIdSchema)
  .handler(({ data }) => deletePricingRow(data.id));

/** What would change if we synced pricing from a remote source. */
export const previewPricingSync = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(syncTargetSchema)
  .handler(({ data }) => previewSync(data));

/**
 * Sync pricing from a remote source. Omitting modelDbIds syncs every model;
 * onlyMissing skips the ones that already have pricing.
 */
export const runPricingSync = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(syncRunSchema)
  .handler(({ data }) => syncPricing(data));

/** Free-text search of the remote catalogue, for the admin autocomplete. */
export const searchRemotePricing = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(remoteSearchSchema)
  .handler(({ data }) => searchPricingCatalog(data));

export const pricingQueries = {
  all: () => ['pricing'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    listWithModels: () => ['pricing', 'listWithModels'] as const,
    searchRemote: () => ['pricing', 'searchRemote'] as const
  },
  listWithModels: (
    input: {
      capability?: 'chat' | 'image' | 'video' | 'audio';
      providerId?: string;
    } = {}
  ) =>
    queryOptions({
      queryKey: [...pricingQueries.key.listWithModels(), input] as const,
      queryFn: () => listPricingWithModels({ data: input })
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
