import { createServerFn } from '@tanstack/react-start';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { DEFAULT_PAGE_SIZE } from '@/types/pagination';
import {
  shareChatSchema,
  shareIdSchema,
  sharePageSchema
} from '@/types/shared-link';
import { authedMiddleware } from '@/server/middleware';
import * as shares from '@/server/services/share';

export const createShare = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(shareChatSchema)
  .handler(({ data, context }) =>
    shares.createShare(context.user.id, data.chatId)
  );

export const listShares = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(sharePageSchema)
  .handler(({ data, context }) => shares.listShares(context.user.id, data));

/** Public by design: a share link is readable by whoever holds it. */
export const getSharedChat = createServerFn({ method: 'GET' })
  .validator(shareIdSchema)
  .handler(({ data }) => shares.getSharedChat(data.id));

export const deleteShare = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(shareIdSchema)
  .handler(({ data, context }) => shares.deleteShare(context.user.id, data.id));

export const deleteAllShares = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .handler(({ context }) => shares.deleteAllShares(context.user.id));

export const shareQueries = {
  all: () => ['share'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    list: () => ['share', 'list'] as const
  },
  /** One page of the user's share links. */
  list: (input: { page?: number; pageSize?: number } = {}) =>
    queryOptions({
      queryKey: [...shareQueries.key.list(), input] as const,
      queryFn: () =>
        listShares({
          data: { page: 1, pageSize: DEFAULT_PAGE_SIZE, ...input }
        }),
      // Paging changes the key, so without this every page turn would read as
      // a first load and blank the table. The previous page stays on screen
      // until the next one lands.
      placeholderData: keepPreviousData
    })
};
