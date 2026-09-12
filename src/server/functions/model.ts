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
import * as models from '@/server/services/model';

export const listModels = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(modelListSchema)
  .handler(({ data }) => models.listModels(data));

export const createModel = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(modelCreateSchema)
  .handler(({ data }) => models.createModel(data));

export const updateModel = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(modelUpdateSchema)
  .handler(({ data }) => models.updateModel(data));

export const deleteModel = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(modelIdSchema)
  .handler(({ data }) => models.deleteModel(data.id));

export const toggleEnabledModel = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(modelToggleSchema)
  .handler(({ data }) => models.toggleEnabledModel(data.id, data.isEnabled));

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
