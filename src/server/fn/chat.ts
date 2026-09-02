import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';

import { chatTypeSchema, messageSchema } from '@/types';
import { db } from '@/server/db';
import { artifacts, chats, messages } from '@/server/db/schema';
import { authedMiddleware } from '@/server/middleware';

export const createChat = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(
    z.object({
      id: z.string().min(1),
      title: z.string().trim().min(1).max(255),
      type: chatTypeSchema.default('chat'),
      modelId: z.string().trim().min(1).max(255),
      messages: z.array(messageSchema)
    })
  )
  .handler(async ({ data, context }) => {
    await db.insert(chats).values({
      id: data.id,
      title: data.title,
      type: data.type,
      modelId: data.modelId,
      userId: context.user.id
    });

    await db.insert(messages).values(
      data.messages.map(message => ({
        id: message.id,
        role: message.role,
        parts: message.parts,
        chatId: data.id,
        userId: context.user.id
      }))
    );
  });

export const updateChat = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(
    z.object({
      id: z.string().min(1),
      title: z.string().trim().min(1).max(255).optional(),
      modelId: z.string().trim().min(1).max(255).optional()
    })
  )
  .handler(async ({ data, context }) => {
    const updates: Record<string, any> = {};
    if (data.title) updates.title = data.title;
    if (data.modelId) updates.modelId = data.modelId;

    if (Object.keys(updates).length > 0) {
      await db
        .update(chats)
        .set({ ...updates, updatedAt: new Date() })
        .where(and(eq(chats.id, data.id), eq(chats.userId, context.user.id)));
    }
  });

export const listChats = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(
    z.object({
      type: chatTypeSchema.optional(),
      limit: z.number().min(1).default(50).optional(),
      offset: z.number().min(0).default(0).optional(),
      cursor: z.number().nullish()
    })
  )
  .handler(async ({ data, context }) => {
    const type = data.type;
    const limit = data.limit ?? 50;
    const offset = data.cursor ?? data.offset ?? 0;

    return await db.query.chats.findMany({
      orderBy: (chats, { desc }) => [desc(chats.createdAt)],
      limit: limit,
      offset: offset,
      where: and(
        eq(chats.userId, context.user.id),
        type ? eq(chats.type, type) : undefined
      ),
      columns: {
        userId: false
      }
    });
  });

export const getChat = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(
    z.object({
      id: z.string().min(1),
      type: chatTypeSchema.optional(),
      includeMessages: z.boolean().default(true),
      includeArtifacts: z.boolean().default(false)
    })
  )
  .handler(async ({ data, context }) => {
    const chat = await db.query.chats.findFirst({
      where: and(
        eq(chats.id, data.id),
        eq(chats.userId, context.user.id),
        data.type ? eq(chats.type, data.type) : undefined
      ),
      with: {
        model: {
          with: {
            provider: true
          }
        },
        messages: data.includeMessages
          ? {
              where: eq(messages.userId, context.user.id),
              orderBy: (messages, { asc }) => [asc(messages.createdAt)],
              columns: {
                userId: false,
                chatId: false
              }
            }
          : undefined,
        artifacts: data.includeArtifacts
          ? {
              where: and(
                eq(artifacts.userId, context.user.id),
                isNotNull(artifacts.messageId)
              ),
              orderBy: (artifacts, { asc }) => [asc(artifacts.createdAt)],
              columns: {
                userId: false
              }
            }
          : undefined
      },
      columns: {
        userId: false
      }
    });

    if (!chat) return null;

    return {
      ...chat,
      modelId:
        chat.model?.isEnabled && chat.model.provider?.isEnabled
          ? chat.model.modelId
          : null
    };
  });

export const deleteChat = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    await db
      .delete(chats)
      .where(and(eq(chats.id, data.id), eq(chats.userId, context.user.id)));
  });

export const deleteAllChats = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .handler(async ({ context }) => {
    await db.delete(chats).where(eq(chats.userId, context.user.id));
  });

type ListInput = { type?: z.infer<typeof chatTypeSchema>; limit?: number };

export const chatQueries = {
  all: () => ['chat'] as const,
  list: (input: ListInput = {}) =>
    queryOptions({
      queryKey: ['chat', 'list', input] as const,
      queryFn: () => listChats({ data: input })
    }),
  /** The sidebar pages through history; the cursor is the row offset. */
  infinite: (input: ListInput = {}) =>
    infiniteQueryOptions({
      queryKey: ['chat', 'infinite', input] as const,
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
      queryKey: ['chat', 'detail', input] as const,
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
