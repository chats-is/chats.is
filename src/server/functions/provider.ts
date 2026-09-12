import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';

import { modelRefSchema, modelSyncSchema } from '@/types/model';
import {
  providerCreateSchema,
  providerIdSchema,
  providerRefSchema,
  providerToggleSchema,
  providerUpdateSchema
} from '@/types/provider';
import { adminMiddleware } from '@/server/middleware';
import * as providers from '@/server/services/provider';

export const listProviders = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(() => providers.listProviders());

export const listEnabledProviders = createServerFn({ method: 'GET' }).handler(
  () => providers.listEnabledProviders()
);

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
    enabled: () => ['provider', 'enabled'] as const,
    remoteModels: () => ['provider', 'remoteModels'] as const,
    compatible: () => ['provider', 'compatible'] as const
  },
  list: () =>
    queryOptions({
      queryKey: [...providerQueries.key.list()] as const,
      queryFn: () => listProviders()
    }),
  enabled: () =>
    queryOptions({
      queryKey: [...providerQueries.key.enabled()] as const,
      queryFn: () => listEnabledProviders()
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
