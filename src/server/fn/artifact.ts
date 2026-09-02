import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/server/db';
import { artifacts } from '@/server/db/schema';
import { authedMiddleware } from '@/server/middleware';

/** Single artifact with full content — used by Library downloads (the list
 *  feed only carries a truncated preview). */
export const getArtifact = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    const artifact = await db.query.artifacts.findFirst({
      where: and(
        eq(artifacts.id, data.id),
        eq(artifacts.userId, context.user.id)
      ),
      columns: {
        userId: false
      }
    });
    return artifact ?? null;
  });

// All artifacts in a chat. Each artifact is an independent product of the
// message that created it; the canvas switches between them.
export const listArtifacts = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(z.object({ chatId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    return await db.query.artifacts.findMany({
      where: and(
        eq(artifacts.chatId, data.chatId),
        eq(artifacts.userId, context.user.id)
      ),
      orderBy: (artifacts, { asc }) => [asc(artifacts.createdAt)],
      columns: {
        userId: false
      }
    });
  });

/**
 * Query keys live beside the functions they call, so a cache invalidation
 * elsewhere in the app cannot name a key that no longer exists.
 */
export const artifactQueries = {
  all: () => ['artifact'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    get: () => ['artifact', 'get'] as const,
    list: () => ['artifact', 'list'] as const
  },
  get: (input: { id: string }) =>
    queryOptions({
      queryKey: [...artifactQueries.key.get(), input] as const,
      queryFn: () => getArtifact({ data: input })
    }),
  list: (input: { chatId: string }) =>
    queryOptions({
      queryKey: [...artifactQueries.key.list(), input] as const,
      queryFn: () => listArtifacts({ data: input })
    })
};
