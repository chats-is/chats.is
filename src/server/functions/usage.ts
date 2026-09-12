import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';
import { type z } from 'zod';

import {
  usageByUserRangeSchema,
  usageLogFilterSchema,
  usageRangeSchema,
  usageUserSchema
} from '@/types/usage';
import { adminMiddleware, authedMiddleware } from '@/server/middleware';
import {
  listModelsUsedBy,
  readGlobalUsage,
  readOwnUsage,
  readUsageForUser,
  readUsageLog
} from '@/server/services/usage';

/** /settings/usage — the calling user's own usage. */
export const getMyUsage = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(usageRangeSchema)
  .handler(({ data, context }) => readOwnUsage(context.user.id, data.from));

/** /console/users/[id] — admin view of one user. */
export const adminUsageByUser = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(usageByUserRangeSchema)
  .handler(({ data }) => readUsageForUser(data.userId, data.from));

/** /console/usage — admin view across everyone. */
export const adminListUsage = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(usageRangeSchema)
  .handler(({ data }) => readGlobalUsage(data.from));

export const adminUserModels = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(usageUserSchema)
  .handler(({ data }) => listModelsUsedBy(data.userId));

export const adminUsageLog = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(usageLogFilterSchema)
  .handler(({ data }) => readUsageLog(data));

/** What a caller may narrow the log by; all optional here because the query
 *  key is built before the schema's defaults apply. */
type UsageLogFilters = Partial<z.input<typeof usageLogFilterSchema>>;

export const usageQueries = {
  all: () => ['usage'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    me: () => ['usage', 'me'] as const,
    byUser: () => ['usage', 'byUser'] as const,
    adminList: () => ['usage', 'adminList'] as const,
    userModels: () => ['usage', 'userModels'] as const,
    log: () => ['usage', 'log'] as const
  },
  me: (input: { from: Date }) =>
    queryOptions({
      queryKey: [...usageQueries.key.me(), input.from.toISOString()] as const,
      queryFn: () => getMyUsage({ data: input })
    }),
  byUser: (input: { userId: string; from: Date }) =>
    queryOptions({
      queryKey: [
        ...usageQueries.key.byUser(),
        input.userId,
        input.from.toISOString()
      ] as const,
      queryFn: () => adminUsageByUser({ data: input })
    }),
  adminList: (input: { from: Date }) =>
    queryOptions({
      queryKey: [
        ...usageQueries.key.adminList(),
        input.from.toISOString()
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
        adminUsageLog({ data: { page: 1, pageSize: 50, ...filters } })
    })
};
