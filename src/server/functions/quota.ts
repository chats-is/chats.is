import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';

import {
  quotaAssignSchema,
  quotaCreateSchema,
  quotaIdSchema,
  quotaUpdateSchema,
  quotaUserSchema
} from '@/types/quota';
import { adminMiddleware, authedMiddleware } from '@/server/middleware';
import {
  clearUserQuotaOverride,
  deleteQuota as deleteQuotaRow,
  getUserQuota,
  insertQuota,
  listQuotaSummaries,
  listQuotasWithDefault,
  setUserQuotaOverride,
  updateQuota as updateQuotaRow
} from '@/server/services/quota';

export const listQuotas = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(() => listQuotasWithDefault());

export const listQuotasForSelect = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(() => listQuotaSummaries());

export const createQuota = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(quotaCreateSchema)
  .handler(({ data }) => insertQuota(data));

export const updateQuota = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(quotaUpdateSchema)
  .handler(({ data }) => updateQuotaRow(data));

export const deleteQuota = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(quotaIdSchema)
  .handler(({ data }) => deleteQuotaRow(data.id));

/** Current user's quota — percentages and reset times, never dollars. */
export const getMyQuota = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .handler(({ context }) => getUserQuota(context.user.id));

/** Admin: any user's quota, same shape. */
export const getQuotaForUser = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(quotaUserSchema)
  .handler(({ data }) => getUserQuota(data.userId));

export const setUserQuota = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(quotaAssignSchema)
  .handler(({ data }) => setUserQuotaOverride(data.userId, data.quotaId));

export const removeUserQuota = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(quotaUserSchema)
  .handler(({ data }) => clearUserQuotaOverride(data.userId));

export const quotaQueries = {
  all: () => ['quota'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    list: () => ['quota', 'list'] as const,
    listForSelect: () => ['quota', 'listForSelect'] as const,
    me: () => ['quota', 'me'] as const,
    byUser: () => ['quota', 'byUser'] as const
  },
  list: () =>
    queryOptions({
      queryKey: [...quotaQueries.key.list()] as const,
      queryFn: () => listQuotas()
    }),
  listForSelect: () =>
    queryOptions({
      queryKey: [...quotaQueries.key.listForSelect()] as const,
      queryFn: () => listQuotasForSelect()
    }),
  me: () =>
    queryOptions({
      queryKey: [...quotaQueries.key.me()] as const,
      queryFn: () => getMyQuota()
    }),
  byUser: (input: { userId: string }) =>
    queryOptions({
      queryKey: [...quotaQueries.key.byUser(), input] as const,
      queryFn: () => getQuotaForUser({ data: input })
    })
};
