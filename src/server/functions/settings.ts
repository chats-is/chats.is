import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';

import {
  settingKeySchema,
  settingsBulkSchema,
  settingSchema
} from '@/types/settings';
import { adminMiddleware } from '@/server/middleware';
import * as settings from '@/server/services/settings';

export const listSettings = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(() => settings.listSettings());

/**
 * What the document itself needs: the name the installation gives itself,
 * which the title and description follow from, and the two ids that decide
 * whether an analytics script is written into the page.
 */
export const getAppSettings = createServerFn({ method: 'GET' }).handler(() =>
  settings.getAppSettings()
);

/**
 * Get complete system settings for client initialization
 * Includes all enabled models and default settings
 */
export const getSystemSettings = createServerFn({ method: 'GET' }).handler(() =>
  settings.getSystemSettings()
);

export const updateSetting = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(settingSchema)
  .handler(({ data }) => settings.updateSetting(data));

export const bulkUpdateSettings = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(settingsBulkSchema)
  .handler(({ data }) => settings.bulkUpdateSettings(data));

export const deleteSetting = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(settingKeySchema)
  .handler(({ data }) => settings.deleteSetting(data.key));

export const settingsQueries = {
  all: () => ['settings'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    list: () => ['settings', 'list'] as const,
    system: () => ['settings', 'system'] as const,
    app: () => ['settings', 'app'] as const
  },
  list: () =>
    queryOptions({
      queryKey: [...settingsQueries.key.list()] as const,
      queryFn: () => listSettings()
    }),
  system: () =>
    queryOptions({
      queryKey: [...settingsQueries.key.system()] as const,
      queryFn: () => getSystemSettings()
    }),
  /** The installation's own name and description, read by the root route. */
  app: () =>
    queryOptions({
      queryKey: [...settingsQueries.key.app()] as const,
      queryFn: () => getAppSettings()
    })
};
