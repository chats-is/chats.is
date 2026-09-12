import { createServerFn } from '@tanstack/react-start';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import {
  promptCreateSchema,
  promptIdSchema,
  promptPageSchema,
  promptUpdateSchema
} from '@/types/prompt';
import { adminMiddleware, authedMiddleware } from '@/server/middleware';
import * as prompts from '@/server/services/prompt';

export const getPromptStats = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(() => prompts.getPromptStats());

export const adminListPrompts = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(() => prompts.adminListPrompts());

export const listPrompts = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .handler(({ context }) => prompts.listPrompts(context.user.id));

export const listUsablePrompts = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(promptPageSchema)
  .handler(({ data, context }) =>
    prompts.listUsablePrompts(context.user.id, data)
  );

export const createPrompt = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(promptCreateSchema)
  .handler(({ data, context }) =>
    prompts.createPrompt(context.user.id, data, 'private')
  );

export const updatePrompt = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(promptUpdateSchema)
  .handler(({ data, context }) => prompts.updatePrompt(context.user.id, data));

export const deletePrompt = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(promptIdSchema)
  .handler(({ data, context }) =>
    prompts.deletePrompt(context.user.id, data.id)
  );

/** Admin console: a public prompt available to everyone. */
export const adminCreatePrompt = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(promptCreateSchema)
  .handler(({ data, context }) =>
    prompts.createPrompt(context.user.id, data, 'public')
  );

export const adminUpdatePrompt = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(promptUpdateSchema)
  .handler(({ data }) => prompts.adminUpdatePrompt(data));

export const adminDeletePrompt = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(promptIdSchema)
  .handler(({ data }) => prompts.adminDeletePrompt(data.id));

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
