import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';
import { and, eq, inArray, or } from 'drizzle-orm';

import {
  messageChatSchema,
  messageCreateSchema,
  messageDeleteSchema,
  messageUpdateSchema
} from '@/types/message';
import { db } from '@/db';
import { artifacts, messages } from '@/db/schema';
import { authedMiddleware } from '@/server/middleware';

export const listMessages = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(messageChatSchema)
  .handler(async ({ data, context }) => {
    return await db.query.messages.findMany({
      where: and(
        eq(messages.chatId, data.chatId),
        eq(messages.userId, context.user.id)
      ),
      orderBy: (messages, { asc }) => [asc(messages.createdAt)],
      columns: {
        userId: false,
        chatId: false
      }
    });
  });

export const createMessages = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(messageCreateSchema)
  .handler(async ({ data, context }) => {
    const result = await db
      .insert(messages)
      .values(
        data.messages.map(message => ({
          id: message.id,
          parentId: message.metadata?.parentId,
          role: message.role,
          parts: message.parts,
          chatId: data.chatId,
          userId: context.user.id,
          reasonDuration: message.metadata?.reasonDuration,
          createdAt: message.metadata?.createdAt,
          updatedAt: message.metadata?.updatedAt
        }))
      )
      .returning({
        id: messages.id,
        parentId: messages.parentId,
        role: messages.role,
        parts: messages.parts,
        reasonDuration: messages.reasonDuration,
        createdAt: messages.createdAt,
        updatedAt: messages.updatedAt
      });

    return result[0];
  });

export const updateMessage = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(messageUpdateSchema)
  .handler(async ({ data, context }) => {
    const result = await db
      .update(messages)
      .set({
        parts: data.message.parts,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(messages.id, data.message.id),
          eq(messages.userId, context.user.id),
          eq(messages.role, 'user') // Only allow editing user messages
        )
      )
      .returning({
        id: messages.id,
        parentId: messages.parentId,
        role: messages.role,
        parts: messages.parts,
        reasonDuration: messages.reasonDuration,
        createdAt: messages.createdAt,
        updatedAt: messages.updatedAt
      });

    return result[0];
  });

export const deleteMessages = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(messageDeleteSchema)
  .handler(async ({ data, context }) => {
    const conditions = data.id
      ? or(eq(messages.id, data.id), eq(messages.parentId, data.id))
      : eq(messages.parentId, data.parentId!);

    await db.transaction(async tx => {
      const targetMessages = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(and(conditions, eq(messages.userId, context.user.id)));

      const targetMessageIds = targetMessages.map(message => message.id);

      if (targetMessageIds.length > 0) {
        await tx
          .delete(artifacts)
          .where(
            and(
              inArray(artifacts.messageId, targetMessageIds),
              eq(artifacts.userId, context.user.id)
            )
          );
      }

      await tx
        .delete(messages)
        .where(and(conditions, eq(messages.userId, context.user.id)));
    });
  });

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
