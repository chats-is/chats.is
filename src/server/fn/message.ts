import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';
import { and, eq, inArray, or } from 'drizzle-orm';
import { z } from 'zod';

import { messageSchema } from '@/types';
import { db } from '@/server/db';
import { artifacts, messages } from '@/server/db/schema';
import { authedMiddleware } from '@/server/middleware';

export const listMessages = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(z.object({ chatId: z.string().min(1) }))
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
  .validator(
    z.object({
      chatId: z.string().min(1),
      messages: z.array(messageSchema)
    })
  )
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
  .validator(
    z.object({
      id: z.string().min(1),
      message: messageSchema
    })
  )
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
  .validator(
    z
      .object({
        id: z.string().trim().min(1).optional(),
        parentId: z.string().trim().min(1).optional()
      })
      .refine(data => !!data.id !== !!data.parentId, {
        message: 'Provide either id or parentId, but not both or neither'
      })
  )
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
  list: (chatId: string) =>
    queryOptions({
      queryKey: ['message', 'list', chatId] as const,
      queryFn: () => listMessages({ data: { chatId } })
    })
};
