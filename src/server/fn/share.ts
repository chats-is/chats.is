import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { generateUUID } from '@/lib/utils';
import { db } from '@/server/db';
import { chats, shares } from '@/server/db/schema';
import { authedMiddleware } from '@/server/middleware';

export const createShare = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(
    z.object({
      chatId: z.string().min(1)
    })
  )
  .handler(async ({ data, context }) => {
    // Verify the chat belongs to the current user
    const chat = await db.query.chats.findFirst({
      where: and(eq(chats.id, data.chatId), eq(chats.userId, context.user.id)),
      columns: { id: true }
    });

    if (!chat) {
      throw new Error('Chat not found');
    }

    // Check if a share already exists for this chat
    const existingShare = await db.query.shares.findFirst({
      where: and(
        eq(shares.chatId, data.chatId),
        eq(shares.userId, context.user.id)
      ),
      columns: { chatId: false, userId: false }
    });

    if (existingShare) {
      return existingShare;
    }

    const shareId = generateUUID();
    const result = await db
      .insert(shares)
      .values({
        id: shareId,
        chatId: data.chatId,
        userId: context.user.id
      })
      .returning({
        id: shares.id,
        createdAt: shares.createdAt
      });

    return result[0];
  });

export const listShares = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(
    z.object({
      limit: z.number().min(1).default(50).optional(),
      offset: z.number().min(0).default(0).optional()
    })
  )
  .handler(async ({ data, context }) => {
    const limit = data.limit ?? 50;
    const offset = data.offset ?? 0;

    return await db.query.shares.findMany({
      orderBy: (shares, { desc }) => [desc(shares.createdAt)],
      limit: limit,
      offset: offset,
      where: eq(shares.userId, context.user.id),
      with: {
        chat: {
          columns: {
            userId: false
          }
        }
      },
      columns: {
        chatId: false,
        userId: false
      }
    });
  });

/** Public by design: a share link is readable by whoever holds it. */
export const getSharedChat = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      id: z.string().min(1)
    })
  )
  .handler(async ({ data }) => {
    const share = await db.query.shares.findFirst({
      where: eq(shares.id, data.id),
      with: {
        chat: {
          with: {
            messages: {
              orderBy: (messages, { asc }) => [asc(messages.createdAt)],
              columns: {
                chatId: false,
                userId: false
              }
            },
            artifacts: {
              orderBy: (artifacts, { asc }) => [asc(artifacts.createdAt)],
              columns: {
                userId: false
              }
            }
          },
          columns: {
            userId: false
          }
        }
      }
    });

    return share?.chat;
  });

export const deleteShare = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    await db
      .delete(shares)
      .where(and(eq(shares.id, data.id), eq(shares.userId, context.user.id)));
  });

export const deleteAllShares = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .handler(async ({ context }) => {
    await db.delete(shares).where(eq(shares.userId, context.user.id));
  });

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
  detail: (id: string) =>
    queryOptions({
      queryKey: [...shareQueries.key.detail(), id] as const,
      queryFn: () => getSharedChat({ data: { id } })
    })
};
