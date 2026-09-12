import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';

import {
  messageChatSchema,
  messageCreateSchema,
  messageDeleteSchema,
  messageUpdateSchema
} from '@/types/message';
import { authedMiddleware } from '@/server/middleware';
import * as messages from '@/server/services/message';

export const listMessages = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(messageChatSchema)
  .handler(({ data, context }) =>
    messages.listMessages(context.user.id, data.chatId)
  );

export const createMessages = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(messageCreateSchema)
  .handler(({ data, context }) =>
    messages.createMessages(context.user.id, data)
  );

export const updateMessage = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(messageUpdateSchema)
  .handler(({ data, context }) =>
    messages.updateMessage(context.user.id, data)
  );

export const deleteMessages = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(messageDeleteSchema)
  .handler(({ data, context }) =>
    messages.deleteMessages(context.user.id, data)
  );

export const messageQueries = {
  all: () => ['message'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    list: () => ['message', 'list'] as const
  },
  list: (input: { chatId: string }) =>
    queryOptions({
      queryKey: [...messageQueries.key.list(), input] as const,
      queryFn: () => listMessages({ data: input })
    })
};
