import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';

import { artifactChatSchema, artifactIdSchema } from '@/types/artifact';
import { authedMiddleware } from '@/server/middleware';
import * as artifacts from '@/server/services/artifact';

export const getArtifact = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(artifactIdSchema)
  .handler(({ data, context }) =>
    artifacts.getArtifact(context.user.id, data.id)
  );

export const listArtifacts = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(artifactChatSchema)
  .handler(({ data, context }) =>
    artifacts.listArtifacts(context.user.id, data.chatId)
  );

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
