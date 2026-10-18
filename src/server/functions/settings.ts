import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';

import {
  settingKeySchema,
  settingsBulkSchema,
  settingSchema,
  sitePageSchema
} from '@/types/settings';
import { adminMiddleware, optionalAuthMiddleware } from '@/server/middleware';
import * as settings from '@/server/services/settings';
import { getUserTier } from '@/server/services/tier';

export const listSettings = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(() => settings.listSettings());

/**
 * What the document itself needs: the name the installation gives itself,
 * which the title and description follow from, whether its pages offer
 * plans, and the two ids that decide whether an analytics script is
 * written into the page.
 */
export const getAppSettings = createServerFn({ method: 'GET' }).handler(() =>
  settings.getAppSettings()
);

/**
 * Get complete system settings for client initialization: the enabled
 * models the signed-in user's tier allows, and the default settings.
 */
export const getSystemSettings = createServerFn({ method: 'GET' })
  .middleware([optionalAuthMiddleware])
  .handler(async ({ context }) =>
    settings.getSystemSettings(
      context.user ? await getUserTier(context.user.id) : null
    )
  );

/** One of the site's own pages — about, terms, privacy — for anyone. */
export const getSitePage = createServerFn({ method: 'GET' })
  .validator(sitePageSchema)
  .handler(({ data }) => settings.getSitePage(data.page));

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
  /**
   * The models on offer, the defaults and the feature switches — what an
   * operator configures and every page of the app is drawn from.
   *
   * It is read by the layout, which is mounted once and stays: nothing about
   * moving between pages ever asks for it again, and nothing here asks on a
   * timer or on a return to the window either. A change made in this tab's
   * own console reaches it at once, by invalidation; one made elsewhere
   * reaches it on the next reload. That is safe: a model that has since been
   * switched off is refused by the server when it is asked for, and the
   * refusal says why.
   *
   * A minute of freshness, so that crossing between the chat and the console
   * — two layouts, each reading this — is not a request each time.
   */
  system: () =>
    queryOptions({
      queryKey: [...settingsQueries.key.system()] as const,
      queryFn: () => getSystemSettings(),
      staleTime: 60 * 1000
    }),
  /** The installation's own name and description, read by the root route. */
  app: () =>
    queryOptions({
      queryKey: [...settingsQueries.key.app()] as const,
      queryFn: () => getAppSettings()
    })
};
