import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';

import {
  profileUpdateSchema,
  userIdSchema,
  userPlanSchema,
  userRoleSchema,
  userSearchSchema
} from '@/types/user';
import { adminMiddleware, authedMiddleware } from '@/server/middleware';
import {
  countUsers,
  deleteUser as deleteUserRow,
  listUsers as listUserRows,
  requireCurrentUser,
  requireUserDetail,
  setUserPlan,
  setUserRole,
  updateOwnProfile
} from '@/server/services/user';

export const getMe = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .handler(async ({ context }) => ({
    ...(await requireCurrentUser(context.user.id)),
    admin: context.user.admin
  }));

export const updateProfile = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(profileUpdateSchema)
  .handler(({ data, context }) => updateOwnProfile(context.user.id, data));

export const listUsers = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(userSearchSchema)
  .handler(({ data }) => listUserRows(data.search));

/**
 * Admin: change a user's plan. Pass planId=null to clear (fall back to default).
 */
export const updateUserPlan = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(userPlanSchema)
  .handler(({ data }) => setUserPlan(data.id, data.planId));

export const getUser = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(userIdSchema)
  .handler(({ data }) => requireUserDetail(data.id));

export const updateUserRole = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(userRoleSchema)
  .handler(({ data, context }) => setUserRole(context.user.id, data));

export const deleteUser = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(userIdSchema)
  .handler(({ data, context }) => deleteUserRow(context.user.id, data.id));

export const getUserStats = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(() => countUsers());

export const userQueries = {
  all: () => ['user'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    me: () => ['user', 'me'] as const,
    list: () => ['user', 'list'] as const,
    detail: () => ['user', 'detail'] as const,
    stats: () => ['user', 'stats'] as const
  },
  me: () =>
    queryOptions({
      queryKey: [...userQueries.key.me()] as const,
      queryFn: () => getMe()
    }),
  list: (input: { limit?: number; offset?: number; search?: string } = {}) =>
    queryOptions({
      queryKey: [...userQueries.key.list(), input] as const,
      queryFn: () => listUsers({ data: input })
    }),
  detail: (input: { id: string }) =>
    queryOptions({
      queryKey: [...userQueries.key.detail(), input] as const,
      queryFn: () => getUser({ data: input })
    }),
  stats: () =>
    queryOptions({
      queryKey: [...userQueries.key.stats()] as const,
      queryFn: () => getUserStats()
    })
};
