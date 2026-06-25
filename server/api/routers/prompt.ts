import { TRPCError } from '@trpc/server';
import { asc, desc, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { generateUUID } from '@/lib/utils';
import {
  adminProcedure,
  createTRPCRouter,
  protectedProcedure
} from '@/server/api/trpc';
import { prompts } from '@/server/db/schema';

const labelArraySchema = z.array(z.string()).nullable().optional();
const visibilitySchema = z.enum(['private', 'public']);

const promptCreateSchema = z.object({
  name: z.string().min(1).max(100),
  content: z.string().min(1),
  image: z.string().max(500).nullable().optional(),
  tags: labelArraySchema,
  providers: labelArraySchema,
  models: labelArraySchema,
  visibility: visibilitySchema.optional(),
  displayOrder: z.number().int().default(0)
});

const promptUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  content: z.string().min(1).optional(),
  image: z.string().max(500).nullable().optional(),
  tags: labelArraySchema,
  providers: labelArraySchema,
  models: labelArraySchema,
  visibility: visibilitySchema.optional(),
  displayOrder: z.number().int().optional()
});

const promptOrderBy = [asc(prompts.displayOrder), desc(prompts.createdAt)];

const promptOwner = {
  user: {
    columns: {
      id: true,
      name: true,
      email: true
    }
  }
} as const;

async function getPromptByIdOrThrow(
  ctx: { db: typeof import('@/server/db').db },
  id: string
) {
  const prompt = await ctx.db.query.prompts.findFirst({
    where: eq(prompts.id, id),
    with: promptOwner
  });

  if (!prompt) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Prompt not found'
    });
  }

  return prompt;
}

export const promptRouter = createTRPCRouter({
  adminStats: adminProcedure.query(async ({ ctx }) => {
    const [totalRows, groupedRows] = await Promise.all([
      ctx.db.select({ count: sql<number>`count(*)` }).from(prompts),
      ctx.db
        .select({
          visibility: prompts.visibility,
          count: sql<number>`count(*)`
        })
        .from(prompts)
        .groupBy(prompts.visibility)
    ]);

    const countFor = (visibility: 'public' | 'private') =>
      Number(
        groupedRows.find(row => row.visibility === visibility)?.count || 0
      );

    return {
      total: Number(totalRows[0]?.count || 0),
      public: countFor('public'),
      private: countFor('private')
    };
  }),

  // Admins manage every prompt in the system, regardless of owner/visibility.
  adminList: adminProcedure.query(async ({ ctx }) => {
    return await ctx.db.query.prompts.findMany({
      orderBy: () => promptOrderBy,
      with: promptOwner
    });
  }),

  // The signed-in user's own prompts (personal library management).
  list: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.db.query.prompts.findMany({
      where: eq(prompts.userId, ctx.session.user.id),
      orderBy: () => promptOrderBy
    });
  }),

  // Prompts the user can insert: their own (any visibility) + all public ones.
  listUsable: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.db.query.prompts.findMany({
      columns: {
        id: true,
        name: true,
        tags: true,
        providers: true,
        models: true,
        image: true,
        content: true
      },
      where: or(
        eq(prompts.userId, ctx.session.user.id),
        eq(prompts.visibility, 'public')
      ),
      orderBy: () => promptOrderBy
    });
  }),

  create: protectedProcedure
    .input(promptCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const id = generateUUID();

      await ctx.db.insert(prompts).values({
        id,
        name: input.name,
        userId: ctx.session.user.id,
        visibility: input.visibility ?? 'private',
        tags: input.tags,
        providers: input.providers,
        models: input.models,
        image: input.image,
        content: input.content,
        displayOrder: input.displayOrder
      });

      return { id };
    }),

  update: protectedProcedure
    .input(promptUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const prompt = await getPromptByIdOrThrow(ctx, input.id);
      if (prompt.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only edit your own prompts'
        });
      }

      const { id, ...updates } = input;

      await ctx.db
        .update(prompts)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(prompts.id, id));
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const prompt = await getPromptByIdOrThrow(ctx, input.id);
      if (prompt.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only delete your own prompts'
        });
      }

      await ctx.db.delete(prompts).where(eq(prompts.id, input.id));
    }),

  // Admin console: add a public prompt available to all users.
  adminCreate: adminProcedure
    .input(promptCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const id = generateUUID();

      await ctx.db.insert(prompts).values({
        id,
        name: input.name,
        userId: ctx.session.user.id,
        visibility: input.visibility ?? 'public',
        tags: input.tags,
        providers: input.providers,
        models: input.models,
        image: input.image,
        content: input.content,
        displayOrder: input.displayOrder
      });

      return { id };
    }),

  // Admin console: edit any prompt in the system.
  adminUpdate: adminProcedure
    .input(promptUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      await getPromptByIdOrThrow(ctx, input.id);
      const { id, ...updates } = input;

      await ctx.db
        .update(prompts)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(prompts.id, id));
    }),

  // Admin console: delete any prompt in the system.
  adminDelete: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await getPromptByIdOrThrow(ctx, input.id);
      await ctx.db.delete(prompts).where(eq(prompts.id, input.id));
    })
});
