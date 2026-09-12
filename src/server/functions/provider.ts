import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';

import { modelRefSchema } from '@/types/model';
import {
  providerCreateSchema,
  providerIdSchema,
  providerModelImportSchema,
  providerRefSchema,
  providerToggleSchema,
  providerUpdateSchema
} from '@/types/provider';
import { adminMiddleware } from '@/server/middleware';
import {
  deleteProvider as deleteProviderRow,
  importMissingProviderModels,
  insertProvider,
  listEnabledProviders as listEnabledProviderRows,
  listProvidersOfferingModel,
  listProvidersWithMaskedKeys,
  listRemoteProviderModels,
  setProviderEnabled,
  updateProvider as updateProviderRow
} from '@/server/services/provider';

export const listProviders = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(() => listProvidersWithMaskedKeys());

export const listEnabledProviders = createServerFn({ method: 'GET' }).handler(
  () => listEnabledProviderRows()
);

export const createProvider = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(providerCreateSchema)
  .handler(({ data }) => insertProvider(data));

export const updateProvider = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(providerUpdateSchema)
  .handler(({ data }) => updateProviderRow(data));

export const deleteProvider = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(providerIdSchema)
  .handler(({ data }) => deleteProviderRow(data.id));

export const toggleEnabledProvider = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(providerToggleSchema)
  .handler(({ data }) => setProviderEnabled(data.id, data.isEnabled));

export const fetchProviderModels = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(providerRefSchema)
  .handler(({ data }) => listRemoteProviderModels(data.providerId));

export const compatibleProviders = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(modelRefSchema)
  .handler(({ data }) => listProvidersOfferingModel(data.modelId));

export const syncProviderModels = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(providerModelImportSchema)
  .handler(({ data }) => importMissingProviderModels(data));

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
