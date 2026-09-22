import { createServerFn } from '@tanstack/react-start';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { type z } from 'zod';

import { modelRefSchema, modelSyncSchema } from '@/types/model';
import { DEFAULT_PAGE_SIZE } from '@/types/pagination';
import {
  providerCreateSchema,
  providerIdSchema,
  providerListSchema,
  providerRefSchema,
  providerToggleSchema,
  providerUpdateSchema
} from '@/types/provider';
import { adminMiddleware } from '@/server/middleware';
import * as providers from '@/server/services/provider';

/** How a caller may narrow the provider table; all optional here because the
 *  query key is built before the schema's defaults apply. */
type ProviderListInput = Partial<z.input<typeof providerListSchema>>;

export const listProviders = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(providerListSchema)
  .handler(({ data }) => providers.listProviders(data));

/** Unpaged, for the selectors that have to offer every provider. */
export const listProvidersForSelect = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(() => providers.listProvidersForSelect());

/** One provider, for the edit form. */
export const getProvider = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(providerIdSchema)
  .handler(({ data }) => providers.getProvider(data.id));

export const createProvider = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(providerCreateSchema)
  .handler(({ data }) => providers.createProvider(data));

export const updateProvider = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(providerUpdateSchema)
  .handler(({ data }) => providers.updateProvider(data));

export const deleteProvider = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(providerIdSchema)
  .handler(({ data }) => providers.deleteProvider(data.id));

export const toggleEnabledProvider = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(providerToggleSchema)
  .handler(({ data }) =>
    providers.toggleEnabledProvider(data.id, data.isEnabled)
  );

export const fetchProviderModels = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(providerRefSchema)
  .handler(({ data }) => providers.fetchProviderModels(data.providerId));

export const compatibleProviders = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(modelRefSchema)
  .handler(({ data }) => providers.compatibleProviders(data.modelId));

export const syncProviderModels = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(modelSyncSchema)
  .handler(({ data }) => providers.syncProviderModels(data));

export const providerQueries = {
  all: () => ['provider'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    list: () => ['provider', 'list'] as const,
    forSelect: () => ['provider', 'forSelect'] as const,
    remoteModels: () => ['provider', 'remoteModels'] as const,
    compatible: () => ['provider', 'compatible'] as const
  },
  /** One page of the console's provider table. */
  list: (input: ProviderListInput = {}) =>
    queryOptions({
      queryKey: [...providerQueries.key.list(), input] as const,
      queryFn: () =>
        listProviders({
          data: { page: 1, pageSize: DEFAULT_PAGE_SIZE, ...input }
        }),
      // Paging changes the key, so without this every page turn would read as
      // a first load and blank the table. The previous page stays on screen
      // until the next one lands.
      placeholderData: keepPreviousData
    }),
  /** Every provider, for a selector that offers one. */
  forSelect: () =>
    queryOptions({
      queryKey: [...providerQueries.key.forSelect()] as const,
      queryFn: () => listProvidersForSelect()
    }),
  /** Reaches the provider's own API, so it is only fetched on demand. */
  remoteModels: (input: { providerId: string }) =>
    queryOptions({
      queryKey: [...providerQueries.key.remoteModels(), input] as const,
      queryFn: () => fetchProviderModels({ data: input })
    }),
  compatible: (input: { modelId: string }) =>
    queryOptions({
      queryKey: [...providerQueries.key.compatible(), input] as const,
      queryFn: () => compatibleProviders({ data: input })
    })
};
