import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';

import {
  modelCreateSchema,
  modelIdSchema,
  modelListSchema,
  modelToggleSchema,
  modelUpdateSchema
} from '@/types/model';
import { adminMiddleware } from '@/server/middleware';
import {
  deleteModel as deleteModelRow,
  insertModel,
  listModelsWithProviders,
  setModelEnabled,
  updateModel as updateModelRow
} from '@/server/services/model';

export const listModels = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(modelListSchema)
  .handler(({ data }) => listModelsWithProviders(data));

export const createModel = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(modelCreateSchema)
  .handler(({ data }) => insertModel(data));

export const updateModel = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(modelUpdateSchema)
  .handler(({ data }) => updateModelRow(data));

export const deleteModel = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(modelIdSchema)
  .handler(({ data }) => deleteModelRow(data.id));

export const toggleEnabledModel = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(modelToggleSchema)
  .handler(({ data }) => setModelEnabled(data.id, data.isEnabled));

export const modelQueries = {
  all: () => ['model'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    list: () => ['model', 'list'] as const
  },
  list: (
    input: {
      capability?: 'chat' | 'image' | 'video' | 'audio';
      providerId?: string;
    } = {}
  ) =>
    queryOptions({
      queryKey: [...modelQueries.key.list(), input] as const,
      queryFn: () => listModels({ data: input })
    })
};
