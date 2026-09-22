import { createServerFn } from '@tanstack/react-start';
import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions
} from '@tanstack/react-query';

import { DEFAULT_PAGE_SIZE } from '@/types/pagination';
import {
  promptCreateSchema,
  promptIdSchema,
  promptListSchema,
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
  .validator(promptListSchema)
  .handler(({ data }) => prompts.adminListPrompts(data));

/** One prompt, whoever owns it, for the console's edit form. */
export const adminGetPrompt = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(promptIdSchema)
  .handler(({ data }) => prompts.adminGetPrompt(data.id));

export const listPrompts = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(promptPageSchema)
  .handler(({ data, context }) => prompts.listPrompts(context.user.id, data));

export const listUsablePrompts = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(promptPageSchema)
  .handler(({ data, context }) =>
    prompts.listUsablePrompts(context.user.id, data)
  );

/** A regular user's own prompt. Always private: only the admin console (below)
 *  may create a shared one, and `visibility` is not a field either form sends. */
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
    listInfinite: () => ['prompt', 'listInfinite'] as const,
    usable: () => ['prompt', 'usable'] as const,
    usableInfinite: () => ['prompt', 'usableInfinite'] as const
  },
  stats: () =>
    queryOptions({
      queryKey: [...promptQueries.key.stats()] as const,
      queryFn: () => getPromptStats()
    }),
  /** One page of the console's prompt table. */
  adminList: (
    input: { search?: string; page?: number; pageSize?: number } = {}
  ) =>
    queryOptions({
      queryKey: [...promptQueries.key.adminList(), input] as const,
      queryFn: () =>
        adminListPrompts({
          data: { page: 1, pageSize: DEFAULT_PAGE_SIZE, ...input }
        }),
      // Paging changes the key, so without this every page turn would read as
      // a first load and blank the table. The previous page stays on screen
      // until the next one lands.
      placeholderData: keepPreviousData
    }),
  usable: () =>
    queryOptions({
      queryKey: [...promptQueries.key.usable()] as const,
      queryFn: () => listUsablePrompts(),
      // The suggestions under an empty composer — the page opened more than
      // any other. The prompts behind them change when someone edits one, and
      // an edit made in this tab invalidates this itself.
      staleTime: 5 * 60 * 1000
    }),
  /** The gallery scrolls; the cursor is the row offset, as the sidebar's is.
   *  `search` is part of the key so a new term starts paging over. */
  usableInfinite: ({
    limit = 24,
    search
  }: { limit?: number; search?: string } = {}) =>
    infiniteQueryOptions({
      queryKey: [
        ...promptQueries.key.usableInfinite(),
        limit,
        search ?? ''
      ] as const,
      queryFn: ({ pageParam }) =>
        listUsablePrompts({ data: { limit, cursor: pageParam, search } }),
      initialPageParam: 0,
      getNextPageParam: (lastPage, allPages) =>
        lastPage.length < limit
          ? undefined
          : allPages.reduce((count, page) => count + page.length, 0)
    }),
  /** My Prompts scrolls the same way the gallery does. */
  listInfinite: ({
    limit = 24,
    search
  }: { limit?: number; search?: string } = {}) =>
    infiniteQueryOptions({
      queryKey: [
        ...promptQueries.key.listInfinite(),
        limit,
        search ?? ''
      ] as const,
      queryFn: ({ pageParam }) =>
        listPrompts({ data: { limit, cursor: pageParam, search } }),
      initialPageParam: 0,
      getNextPageParam: (lastPage, allPages) =>
        lastPage.length < limit
          ? undefined
          : allPages.reduce((count, page) => count + page.length, 0)
    })
};
