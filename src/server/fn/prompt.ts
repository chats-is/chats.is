import { createServerFn } from '@tanstack/react-start';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { asc, desc, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { generateUUID } from '@/lib/utils';
import { db } from '@/server/db';
import { prompts } from '@/server/db/schema';
import { adminMiddleware, authedMiddleware } from '@/server/middleware';

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

// `id` last so the order is total: prompts seeded together share a display
// order and a creation time, and paging by row offset over an order that
// leaves ties unbroken can repeat a row on one page and skip it on the next.
const promptOrderBy = [
  asc(prompts.displayOrder),
  desc(prompts.createdAt),
  asc(prompts.id)
];

const promptOwner = {
  user: {
    columns: {
      id: true,
      name: true,
      email: true
    }
  }
} as const;

async function getPromptByIdOrThrow(id: string) {
  const prompt = await db.query.prompts.findFirst({
    where: eq(prompts.id, id),
    with: promptOwner
  });

  if (!prompt) {
    throw new Response('Prompt not found', { status: 404 });
  }

  return prompt;
}

export const getPromptStats = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(async () => {
    const [totalRows, groupedRows] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(prompts),
      db
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
  });

// Admins manage every prompt in the system, regardless of owner/visibility.
export const adminListPrompts = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(async () => {
    return await db.query.prompts.findMany({
      orderBy: () => promptOrderBy,
      with: promptOwner
    });
  });

// The signed-in user's own prompts (personal library management).
export const listPrompts = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .handler(async ({ context }) => {
    return await db.query.prompts.findMany({
      where: eq(prompts.userId, context.user.id),
      orderBy: () => promptOrderBy
    });
  });

// Prompts the user can insert: their own (any visibility) + all public ones.
export const listUsablePrompts = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  // Paged for the gallery, whole for the composer's suggestions: without a
  // limit this returns everything, which is what a handful of suggestions is
  // picked from.
  .validator(
    z
      .object({
        limit: z.number().min(1).max(100).optional(),
        cursor: z.number().min(0).nullish()
      })
      .optional()
  )
  .handler(async ({ data, context }) => {
    return await db.query.prompts.findMany({
      limit: data?.limit,
      offset: data?.cursor ?? 0,
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
        eq(prompts.userId, context.user.id),
        eq(prompts.visibility, 'public')
      ),
      orderBy: () => promptOrderBy
    });
  });

export const createPrompt = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(promptCreateSchema)
  .handler(async ({ data, context }) => {
    const id = generateUUID();

    await db.insert(prompts).values({
      id,
      name: data.name,
      userId: context.user.id,
      visibility: data.visibility ?? 'private',
      tags: data.tags,
      providers: data.providers,
      models: data.models,
      image: data.image,
      content: data.content,
      displayOrder: data.displayOrder
    });

    return { id };
  });

export const updatePrompt = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(promptUpdateSchema)
  .handler(async ({ data, context }) => {
    const prompt = await getPromptByIdOrThrow(data.id);
    if (prompt.userId !== context.user.id) {
      throw new Response('You can only edit your own prompts', { status: 403 });
    }

    const { id, ...updates } = data;

    await db
      .update(prompts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(prompts.id, id));
  });

export const deletePrompt = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    const prompt = await getPromptByIdOrThrow(data.id);
    if (prompt.userId !== context.user.id) {
      throw new Response('You can only delete your own prompts', {
        status: 403
      });
    }

    await db.delete(prompts).where(eq(prompts.id, data.id));
  });

// Admin console: add a public prompt available to all users.
export const adminCreatePrompt = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(promptCreateSchema)
  .handler(async ({ data, context }) => {
    const id = generateUUID();

    await db.insert(prompts).values({
      id,
      name: data.name,
      userId: context.user.id,
      visibility: data.visibility ?? 'public',
      tags: data.tags,
      providers: data.providers,
      models: data.models,
      image: data.image,
      content: data.content,
      displayOrder: data.displayOrder
    });

    return { id };
  });

// Admin console: edit any prompt in the system.
export const adminUpdatePrompt = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(promptUpdateSchema)
  .handler(async ({ data }) => {
    await getPromptByIdOrThrow(data.id);
    const { id, ...updates } = data;

    await db
      .update(prompts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(prompts.id, id));
  });

// Admin console: delete any prompt in the system.
export const adminDeletePrompt = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await getPromptByIdOrThrow(data.id);
    await db.delete(prompts).where(eq(prompts.id, data.id));
  });

export const promptQueries = {
  all: () => ['prompt'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    stats: () => ['prompt', 'stats'] as const,
    adminList: () => ['prompt', 'adminList'] as const,
    list: () => ['prompt', 'list'] as const,
    usable: () => ['prompt', 'usable'] as const,
    usableInfinite: () => ['prompt', 'usableInfinite'] as const
  },
  stats: () =>
    queryOptions({
      queryKey: [...promptQueries.key.stats()] as const,
      queryFn: () => getPromptStats()
    }),
  adminList: () =>
    queryOptions({
      queryKey: [...promptQueries.key.adminList()] as const,
      queryFn: () => adminListPrompts()
    }),
  list: () =>
    queryOptions({
      queryKey: [...promptQueries.key.list()] as const,
      queryFn: () => listPrompts()
    }),
  usable: () =>
    queryOptions({
      queryKey: [...promptQueries.key.usable()] as const,
      queryFn: () => listUsablePrompts()
    }),
  /** The gallery scrolls; the cursor is the row offset, as the sidebar's is. */
  usableInfinite: ({ limit = 24 }: { limit?: number } = {}) =>
    infiniteQueryOptions({
      queryKey: [...promptQueries.key.usableInfinite(), limit] as const,
      queryFn: ({ pageParam }) =>
        listUsablePrompts({ data: { limit, cursor: pageParam } }),
      initialPageParam: 0,
      getNextPageParam: (lastPage, allPages) =>
        lastPage.length < limit
          ? undefined
          : allPages.reduce((count, page) => count + page.length, 0)
    })
};
