import { TRPCError } from '@trpc/server';
import { eq, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  adminProcedure,
  createTRPCRouter,
  protectedProcedure
} from '@/server/api/trpc';
import { accounts, chats, messages, users } from '@/server/db/schema';

export const userRouter = createTRPCRouter({
  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db
      .select()
      .from(users)
      .where(eq(users.id, ctx.session.user.id));

    if (!user[0]) {
      // Unreachable while protectedProcedure runs on a verified session, but a
      // bare Error here would surface as a 500 and give the client no reason to
      // sign out. A missing row means the session is stale, so say so.
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Session expired' });
    }

    return {
      ...user[0],
      admin: ctx.session.user.admin
    };
  }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100).optional(),
        image: z.url().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const updates: { name?: string; image?: string; updatedAt?: Date } = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.image !== undefined) updates.image = input.image;

      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        await ctx.db
          .update(users)
          .set(updates)
          .where(eq(users.id, ctx.session.user.id));
      }

      return { success: true };
    }),

  list: adminProcedure
    .input(
      z
        .object({
          search: z.string().optional()
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const search = input?.search;

      return await ctx.db.query.users.findMany({
        where: search
          ? or(
              like(users.name, `%${search}%`),
              like(users.email, `%${search}%`)
            )
          : undefined,
        orderBy: (users, { desc }) => [desc(users.createdAt)],
        with: {
          accounts: {
            columns: {
              provider: true
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
    }),

  /**
   * Admin: change a user's plan. Pass planId=null to clear (fall back to default).
   */
  updatePlan: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        planId: z.string().nullable()
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(users)
        .set({ planId: input.planId, updatedAt: new Date() })
        .where(eq(users.id, input.id));
    }),

  get: adminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = await ctx.db
        .select()
        .from(users)
        .where(eq(users.id, input.id));

      if (!user[0]) {
        throw new Error('User not found');
      }

      // Get linked accounts
      const linkedAccounts = await ctx.db
        .select({
          provider: accounts.provider,
          providerAccountId: accounts.providerAccountId
        })
        .from(accounts)
        .where(eq(accounts.userId, input.id));

      // Get chat count
      const chatCount = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(chats)
        .where(eq(chats.userId, input.id));

      // Get message count
      const messageCount = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .where(eq(messages.userId, input.id));

      return {
        ...user[0],
        accounts: linkedAccounts,
        chatCount: Number(chatCount[0]?.count || 0),
        messageCount: Number(messageCount[0]?.count || 0)
      };
    }),

  updateRole: adminProcedure
    .input(
      z.object({
        id: z.string(),
        role: z.enum(['user', 'admin'])
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Prevent admin from removing their own admin role
      if (ctx.session.user.id === input.id && input.role !== 'admin') {
        throw new Error('Cannot remove your own admin role');
      }

      const result = await ctx.db
        .update(users)
        .set({ role: input.role, updatedAt: new Date() })
        .where(eq(users.id, input.id))
        .returning();

      return result[0];
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Prevent admin from deleting themselves
      if (ctx.session.user.id === input.id) {
        throw new Error('Cannot delete your own account');
      }

      // Check if user is admin
      const user = await ctx.db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, input.id));

      if (user[0]?.role === 'admin') {
        throw new Error('Cannot delete admin accounts');
      }

      await ctx.db.delete(users).where(eq(users.id, input.id));
      return { success: true };
    }),

  getStats: adminProcedure.query(async ({ ctx }) => {
    const totalUsers = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(users);

    const adminCount = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.role, 'admin'));

    return {
      total: Number(totalUsers[0]?.count || 0),
      admins: Number(adminCount[0]?.count || 0)
    };
  })
});
