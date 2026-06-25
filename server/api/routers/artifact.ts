import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { artifacts } from '@/server/db/schema';

export const artifactRouter = createTRPCRouter({
  /** Single artifact with full content — used by Library downloads (the list
   *  feed only carries a truncated preview). */
  get: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const artifact = await ctx.db.query.artifacts.findFirst({
        where: and(
          eq(artifacts.id, input.id),
          eq(artifacts.userId, ctx.session.user.id)
        ),
        columns: {
          userId: false
        }
      });
      return artifact ?? null;
    }),

  // All artifacts in a chat. Each artifact is an independent product of the
  // message that created it; the canvas switches between them.
  list: protectedProcedure
    .input(z.object({ chatId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return await ctx.db.query.artifacts.findMany({
        where: and(
          eq(artifacts.chatId, input.chatId),
          eq(artifacts.userId, ctx.session.user.id)
        ),
        orderBy: (artifacts, { asc }) => [asc(artifacts.createdAt)],
        columns: {
          userId: false
        }
      });
    })
});
