import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';

import {
  settingKeySchema,
  settingsBulkSchema,
  settingSchema
} from '@/types/settings';
import { adminMiddleware } from '@/server/middleware';
import {
  deleteSetting as deleteSettingRow,
  listAllSettings,
  getAppSettings as readAppSettings,
  getSystemSettings as readSystemSettings,
  upsertSetting,
  upsertSettings
} from '@/server/services/settings';

export const listSettings = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(() => listAllSettings());

/**
 * What the document itself needs: the name the installation gives itself,
 * which the title and description follow from, and the two ids that decide
 * whether an analytics script is written into the page.
 */
export const getAppSettings = createServerFn({ method: 'GET' }).handler(() =>
  readAppSettings()
);

/**
 * Get complete system settings for client initialization
 * Includes all enabled models and default settings
 */
export const getSystemSettings = createServerFn({ method: 'GET' }).handler(() =>
  readSystemSettings()
);

export const updateSetting = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(settingSchema)
  .handler(({ data }) => upsertSetting(data));

export const bulkUpdateSettings = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(settingsBulkSchema)
  .handler(({ data }) => upsertSettings(data));

export const deleteSetting = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(settingKeySchema)
  .handler(({ data }) => deleteSettingRow(data.key));

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
