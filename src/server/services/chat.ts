import '@tanstack/react-start/server-only';

import { and, eq, isNotNull } from 'drizzle-orm';
import { type z } from 'zod';

import {
  type chatCreateSchema,
  type chatDetailSchema,
  type chatListSchema,
  type chatUpdateSchema
} from '@/types/chat';
import { db } from '@/db';
import { artifacts, chats, messages } from '@/db/schema';

/**
 * Create a chat together with the messages that opened it.
 *
 * The two writes belong to one act: a chat with no messages is never a state
 * the app wants to read back.
 */
export async function createChat(
  userId: string,
  input: z.infer<typeof chatCreateSchema>
) {
  await db.insert(chats).values({
    id: input.id,
    title: input.title,
    type: input.type,
    modelId: input.modelId,
    userId
  });

  await db.insert(messages).values(
    input.messages.map(message => ({
      id: message.id,
      role: message.role,
      parts: message.parts,
      chatId: input.id,
      userId
    }))
  );
}

/** Rename a chat or move it to another model. Absent fields are left alone,
 *  and a request naming none writes nothing. */
export async function updateChat(
  userId: string,
  input: z.infer<typeof chatUpdateSchema>
) {
  const updates: Record<string, unknown> = {};
  if (input.title) updates.title = input.title;
  if (input.modelId) updates.modelId = input.modelId;

  if (Object.keys(updates).length === 0) return;

  await db
    .update(chats)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(chats.id, input.id), eq(chats.userId, userId)));
}

export async function listChats(
  userId: string,
  input: z.infer<typeof chatListSchema>
) {
  const limit = input.limit ?? 50;
  const offset = input.cursor ?? input.offset ?? 0;

  return await db.query.chats.findMany({
    orderBy: (chats, { desc }) => [desc(chats.createdAt)],
    limit: limit,
    offset: offset,
    where: and(
      eq(chats.userId, userId),
      input.type ? eq(chats.type, input.type) : undefined
    ),
    columns: {
      userId: false
    }
  });
}

/**
 * One of the user's chats, or null.
 *
 * `modelId` comes back null when the model or its provider has since been
 * disabled, so the caller cannot offer to continue a conversation on a model
 * that can no longer answer.
 */
export async function getChat(
  userId: string,
  input: z.infer<typeof chatDetailSchema>
) {
  const chat = await db.query.chats.findFirst({
    where: and(
      eq(chats.id, input.id),
      eq(chats.userId, userId),
      input.type ? eq(chats.type, input.type) : undefined
    ),
    with: {
      model: {
        with: {
          provider: true
        }
      },
      messages: input.includeMessages
        ? {
            where: eq(messages.userId, userId),
            orderBy: (messages, { asc }) => [asc(messages.createdAt)],
            columns: {
              userId: false,
              chatId: false
            }
          }
        : undefined,
      artifacts: input.includeArtifacts
        ? {
            where: and(
              eq(artifacts.userId, userId),
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
}

export async function deleteChat(userId: string, id: string) {
  await db.delete(chats).where(and(eq(chats.id, id), eq(chats.userId, userId)));
}

export async function deleteAllChats(userId: string) {
  await db.delete(chats).where(eq(chats.userId, userId));
}
