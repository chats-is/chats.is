import { createServerFn } from '@tanstack/react-start';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { type z } from 'zod';

import { type chatTypeSchema } from '@/types';
import {
  chatCreateSchema,
  chatDetailSchema,
  chatIdSchema,
  chatListSchema,
  chatUpdateSchema
} from '@/types/chat';
import { authedMiddleware } from '@/server/middleware';
import * as chats from '@/server/services/chat';

export const createChat = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(chatCreateSchema)
  .handler(({ data, context }) => chats.createChat(context.user.id, data));

export const updateChat = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(chatUpdateSchema)
  .handler(({ data, context }) => chats.updateChat(context.user.id, data));

export const listChats = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(chatListSchema)
  .handler(({ data, context }) => chats.listChats(context.user.id, data));

export const getChat = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(chatDetailSchema)
  .handler(({ data, context }) => chats.getChat(context.user.id, data));

export const deleteChat = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(chatIdSchema)
  .handler(({ data, context }) => chats.deleteChat(context.user.id, data.id));

export const deleteAllChats = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .handler(({ context }) => chats.deleteAllChats(context.user.id));

type ListInput = { type?: z.infer<typeof chatTypeSchema>; limit?: number };

export const chatQueries = {
  all: () => ['chat'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    list: () => ['chat', 'list'] as const,
    infinite: () => ['chat', 'infinite'] as const,
    detail: () => ['chat', 'detail'] as const
  },
  list: (input: ListInput = {}) =>
    queryOptions({
      queryKey: [...chatQueries.key.list(), input] as const,
      queryFn: () => listChats({ data: input })
    }),
  /** The sidebar pages through history; the cursor is the row offset. */
  infinite: (input: ListInput = {}) =>
    infiniteQueryOptions({
      queryKey: [...chatQueries.key.infinite(), input] as const,
      queryFn: ({ pageParam }) =>
        listChats({ data: { ...input, cursor: pageParam } }),
      initialPageParam: 0,
      getNextPageParam: (lastPage, allPages) =>
        lastPage.length < (input.limit ?? 50)
          ? undefined
          : allPages.reduce((n, p) => n + p.length, 0)
    }),
  detail: (input: {
    id: string;
    type?: z.infer<typeof chatTypeSchema>;
    includeMessages?: boolean;
    includeArtifacts?: boolean;
  }) =>
    queryOptions({
      queryKey: [...chatQueries.key.detail(), input] as const,
      queryFn: () =>
        getChat({
          data: {
            includeMessages: true,
            includeArtifacts: false,
            ...input
          }
        })
    })
};
