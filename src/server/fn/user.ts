import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';
import { eq, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/server/db';
import { accounts, chats, messages, users } from '@/server/db/schema';
import { adminMiddleware, authedMiddleware } from '@/server/middleware';

export const getMe = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .handler(async ({ context }) => {
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, context.user.id));

    if (!user[0]) {
      // Unreachable while protectedProcedure runs on a verified session, but a
      // bare Error here would surface as a 500 and give the client no reason to
      // sign out. A missing row means the session is stale, so say so.
      throw new Response('Session expired', { status: 401 });
    }

    return {
      ...user[0],
      admin: context.user.admin
    };
  });

export const updateProfile = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(
    z.object({
      name: z.string().min(1).max(100).optional(),
      image: z.url().optional()
    })
  )
  .handler(async ({ data, context }) => {
    const updates: { name?: string; image?: string; updatedAt?: Date } = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.image !== undefined) updates.image = data.image;

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await db.update(users).set(updates).where(eq(users.id, context.user.id));
    }

    return { success: true };
  });

export const listUsers = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      search: z.string().optional()
    })
  )
  .handler(async ({ data }) => {
    const search = data.search;

    return await db.query.users.findMany({
      where: search
        ? or(like(users.name, `%${search}%`), like(users.email, `%${search}%`))
        : undefined,
      orderBy: (users, { desc }) => [desc(users.createdAt)],
      with: {
        accounts: {
          columns: {
            providerId: true
          }
        },
        plan: {
          columns: {
            id: true,
            name: true
          }
        },
        quota: {
          columns: {
            id: true,
            name: true,
            isUnlimited: true
          }
        }
      }
    });
  });

/**
 * Admin: change a user's plan. Pass planId=null to clear (fall back to default).
 */
export const updateUserPlan = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      id: z.string().min(1),
      planId: z.string().nullable()
    })
  )
  .handler(async ({ data }) => {
    await db
      .update(users)
      .set({ planId: data.planId, updatedAt: new Date() })
      .where(eq(users.id, data.id));
  });

export const getUser = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await db.select().from(users).where(eq(users.id, data.id));

    if (!user[0]) {
      throw new Error('User not found');
    }

    // Get linked accounts
    const linkedAccounts = await db
      .select({
        provider: accounts.providerId,
        providerAccountId: accounts.accountId
      })
      .from(accounts)
      .where(eq(accounts.userId, data.id));

    // Get chat count
    const chatCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(chats)
      .where(eq(chats.userId, data.id));

    // Get message count
    const messageCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.userId, data.id));

    return {
      ...user[0],
      accounts: linkedAccounts,
      chatCount: Number(chatCount[0]?.count || 0),
      messageCount: Number(messageCount[0]?.count || 0)
    };
  });

export const updateUserRole = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      id: z.string(),
      role: z.enum(['user', 'admin'])
    })
  )
  .handler(async ({ data, context }) => {
    // Prevent admin from removing their own admin role
    if (context.user.id === data.id && data.role !== 'admin') {
      throw new Error('Cannot remove your own admin role');
    }

    const result = await db
      .update(users)
      .set({ role: data.role, updatedAt: new Date() })
      .where(eq(users.id, data.id))
      .returning();

    return result[0];
  });

export const deleteUser = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data, context }) => {
    // Prevent admin from deleting themselves
    if (context.user.id === data.id) {
      throw new Error('Cannot delete your own account');
    }

    // Check if user is admin
    const user = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, data.id));

    if (user[0]?.role === 'admin') {
      throw new Error('Cannot delete admin accounts');
    }

    await db.delete(users).where(eq(users.id, data.id));
    return { success: true };
  });

export const getUserStats = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(async () => {
    const totalUsers = await db
      .select({ count: sql<number>`count(*)` })
      .from(users);

    const adminCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.role, 'admin'));

    return {
      total: Number(totalUsers[0]?.count || 0),
      admins: Number(adminCount[0]?.count || 0)
    };
  });

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
  detail: (id: string) =>
    queryOptions({
      queryKey: [...userQueries.key.detail(), id] as const,
      queryFn: () => getUser({ data: { id } })
    }),
  stats: () =>
    queryOptions({
      queryKey: [...userQueries.key.stats()] as const,
      queryFn: () => getUserStats()
    })
};
