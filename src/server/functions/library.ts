import { createServerFn } from '@tanstack/react-start';
import { infiniteQueryOptions } from '@tanstack/react-query';

import { libraryPageSchema } from '@/types/library';
import { authedMiddleware } from '@/server/middleware';
import * as library from '@/server/services/library';

export type { LibraryItem } from '@/server/services/library';

export const listLibrary = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(libraryPageSchema)
  .handler(({ data, context }) => library.listLibrary(context.user.id, data));

export const libraryQueries = {
  all: () => ['library'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    list: () => ['library', 'list'] as const
  },
  /** The library scrolls; the cursor is the timestamp of the last item shown. */
  list: ({ limit = 24 }: { limit?: number } = {}) =>
    infiniteQueryOptions({
      queryKey: [...libraryQueries.key.list(), limit] as const,
      queryFn: ({ pageParam }) =>
        listLibrary({ data: { cursor: pageParam, limit } }),
      initialPageParam: null as string | null | undefined,
      getNextPageParam: lastPage => lastPage.nextCursor
    })
};
