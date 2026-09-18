import { createServerFn } from '@tanstack/react-start';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { type z } from 'zod';

import {
  modelCreateSchema,
  modelIdSchema,
  modelListSchema,
  modelToggleSchema,
  modelUpdateSchema
} from '@/types/model';
import { DEFAULT_PAGE_SIZE } from '@/types/pagination';
import { adminMiddleware } from '@/server/middleware';
import * as models from '@/server/services/model';

/** How a caller may narrow the model table; all optional here because the
 *  query key is built before the schema's defaults apply. */
type ModelListInput = Partial<z.input<typeof modelListSchema>>;

export const listModels = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(modelListSchema)
  .handler(({ data }) => models.listModels(data));

/** Unpaged, for the selectors that have to offer every model. */
export const listModelsForSelect = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(() => models.listModelsForSelect());

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
    list: () => ['model', 'list'] as const,
    forSelect: () => ['model', 'forSelect'] as const
  },
  /** One page of the console's model table. */
  list: (input: ModelListInput = {}) =>
    queryOptions({
      queryKey: [...modelQueries.key.list(), input] as const,
      queryFn: () =>
        listModels({
          data: { page: 1, pageSize: DEFAULT_PAGE_SIZE, ...input }
        }),
      // Paging changes the key, so without this every page turn would read as
      // a first load and blank the table. The previous page stays on screen
      // until the next one lands.
      placeholderData: keepPreviousData
    }),
  /** Every model, for a selector that offers one. */
  forSelect: () =>
    queryOptions({
      queryKey: [...modelQueries.key.forSelect()] as const,
      queryFn: () => listModelsForSelect()
    })
};
