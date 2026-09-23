import { createServerFn } from '@tanstack/react-start';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { type z } from 'zod';

import { DEFAULT_PAGE_SIZE } from '@/types/pagination';
import {
  usageByUserRangeSchema,
  usageLogFilterSchema,
  usageRangeSchema,
  usageUserSchema
} from '@/types/usage';
import { adminMiddleware } from '@/server/middleware';
import * as usage from '@/server/services/usage';

/** /console/users/[id] — admin view of one user. */
export const adminUsageByUser = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(usageByUserRangeSchema)
  .handler(({ data }) => usage.adminUsageByUser(data.userId, data.from));

/** The console overview's stats — admin view across everyone. */
export const adminListUsage = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(usageRangeSchema)
  .handler(({ data }) => usage.adminListUsage(data.from, data.to));

export const adminUserModels = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(usageUserSchema)
  .handler(({ data }) => usage.adminUserModels(data.userId));

export const adminUsageLog = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(usageLogFilterSchema)
  .handler(({ data }) => usage.adminUsageLog(data));

/** What a caller may narrow the log by; all optional here because the query
 *  key is built before the schema's defaults apply. */
type UsageLogFilters = Partial<z.input<typeof usageLogFilterSchema>>;

export const usageQueries = {
  all: () => ['usage'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    byUser: () => ['usage', 'byUser'] as const,
    adminList: () => ['usage', 'adminList'] as const,
    userModels: () => ['usage', 'userModels'] as const,
    log: () => ['usage', 'log'] as const
  },
  byUser: (input: { userId: string; from: Date }) =>
    queryOptions({
      queryKey: [
        ...usageQueries.key.byUser(),
        input.userId,
        input.from.toISOString()
      ] as const,
      queryFn: () => adminUsageByUser({ data: input })
    }),
  adminList: (input: { from: Date; to?: Date }) =>
    queryOptions({
      queryKey: [
        ...usageQueries.key.adminList(),
        input.from.toISOString(),
        input.to?.toISOString() ?? null
      ] as const,
      queryFn: () => adminListUsage({ data: input })
    }),
  userModels: (input: { userId: string }) =>
    queryOptions({
      queryKey: [...usageQueries.key.userModels(), input] as const,
      queryFn: () => adminUserModels({ data: input })
    }),
  log: (filters: UsageLogFilters = {}) =>
    queryOptions({
      queryKey: [...usageQueries.key.log(), filters] as const,
      queryFn: () =>
        adminUsageLog({
          data: { page: 1, pageSize: DEFAULT_PAGE_SIZE, ...filters }
        }),
      // Paging changes the key, so without this every page turn would read as
      // a first load and blank the table. The previous page stays on screen
      // until the next one lands.
      placeholderData: keepPreviousData
    })
};
