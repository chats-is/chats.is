import { createServerFn } from '@tanstack/react-start';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { type z } from 'zod';

import {
  usageLogFilterSchema,
  usageStatsSchema,
  usageUserSchema
} from '@/types/usage';
import { DEFAULT_PAGE_SIZE } from '@/lib/constant';
import { adminMiddleware } from '@/server/middleware';
import { stepOf } from '@/server/services/db-utils';
import * as usage from '@/server/services/usage';

/** The console's usage over a window — on the Usage page everyone's, on a
 *  user's page theirs. */
export const adminUsageStats = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(usageStatsSchema)
  .handler(({ data }) =>
    usage.adminUsageStats(data.from, data.to, data.userId, stepOf(data.hourly))
  );

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
    stats: () => ['usage', 'stats'] as const,
    userModels: () => ['usage', 'userModels'] as const,
    log: () => ['usage', 'log'] as const
  },
  stats: (input: {
    from: Date;
    to?: Date;
    userId?: string;
    hourly?: boolean;
  }) =>
    queryOptions({
      queryKey: [
        ...usageQueries.key.stats(),
        input.userId ?? null,
        input.from.toISOString(),
        input.to?.toISOString() ?? null,
        input.hourly ?? false
      ] as const,
      queryFn: () => adminUsageStats({ data: input }),
      // A new window changes the key; the last one stays on screen until
      // the new one lands, rather than the page blanking.
      placeholderData: keepPreviousData
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
