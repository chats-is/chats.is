import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';

import {
  shareChatSchema,
  shareIdSchema,
  sharePageSchema
} from '@/types/shared-link';
import { authedMiddleware } from '@/server/middleware';
import {
  deleteAllOwnShares,
  deleteOwnShare,
  findChatBehindShare,
  findOrCreateShare,
  listOwnedShares
} from '@/server/services/share';

export const createShare = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(shareChatSchema)
  .handler(({ data, context }) =>
    findOrCreateShare(context.user.id, data.chatId)
  );

export const listShares = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(sharePageSchema)
  .handler(({ data, context }) => listOwnedShares(context.user.id, data));

/** Public by design: a share link is readable by whoever holds it. */
export const getSharedChat = createServerFn({ method: 'GET' })
  .validator(shareIdSchema)
  .handler(({ data }) => findChatBehindShare(data.id));

export const deleteShare = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(shareIdSchema)
  .handler(({ data, context }) => deleteOwnShare(context.user.id, data.id));

export const deleteAllShares = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .handler(({ context }) => deleteAllOwnShares(context.user.id));

export const shareQueries = {
  all: () => ['share'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    list: () => ['share', 'list'] as const,
    detail: () => ['share', 'detail'] as const
  },
  list: (input: { limit?: number; offset?: number } = {}) =>
    queryOptions({
      queryKey: [...shareQueries.key.list(), input] as const,
      queryFn: () => listShares({ data: input })
    }),
  detail: (input: { id: string }) =>
    queryOptions({
      queryKey: [...shareQueries.key.detail(), input] as const,
      queryFn: () => getSharedChat({ data: input })
    })
};
