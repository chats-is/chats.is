import { createServerFn } from '@tanstack/react-start';

import {
  messageChatSchema,
  messageDeleteSchema,
  messageUpdateSchema
} from '@/types/message';
import { authedMiddleware } from '@/server/middleware';
import { PublicError } from '@/server/public-error';
import { carriesOnlyOwnFiles } from '@/server/services/blob';
import * as messages from '@/server/services/message';

export const listMessages = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(messageChatSchema)
  .handler(({ data, context }) =>
    messages.listMessages(context.user.id, data.chatId)
  );

export const updateMessage = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(messageUpdateSchema)
  .handler(({ data, context }) => {
    if (!carriesOnlyOwnFiles(data.message.parts)) {
      throw new PublicError('Attachments must be uploaded through this app');
    }
    return messages.updateMessage(context.user.id, data);
  });

export const deleteMessages = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(messageDeleteSchema)
  .handler(({ data, context }) =>
    messages.deleteMessages(context.user.id, data)
  );
