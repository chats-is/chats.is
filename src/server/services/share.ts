import '@tanstack/react-start/server-only';

import { and, eq } from 'drizzle-orm';
import { type z } from 'zod';

import { type sharePageSchema } from '@/types/shared-link';
import { generateUUID } from '@/lib/utils';
import { db } from '@/db';
import { chats, shares } from '@/db/schema';
import { PublicError } from '@/server/public-error';

/**
 * Share a chat, or hand back the share it already has.
 *
 * Sharing twice is the same act as sharing once — a link someone copied
 * earlier has to keep working — so this returns the existing row rather than
 * minting a second id for the same chat.
 */
export async function createShare(userId: string, chatId: string) {
  const chat = await db.query.chats.findFirst({
    where: and(eq(chats.id, chatId), eq(chats.userId, userId)),
    columns: { id: true }
  });

  if (!chat) {
    throw new PublicError('Chat not found');
  }

  const existingShare = await db.query.shares.findFirst({
    where: and(eq(shares.chatId, chatId), eq(shares.userId, userId)),
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
      chatId,
      userId
    })
    .returning({
      id: shares.id,
      createdAt: shares.createdAt
    });

  return result[0];
}

export async function listShares(
  userId: string,
  input: z.infer<typeof sharePageSchema>
) {
  const limit = input.limit ?? 50;
  const offset = input.offset ?? 0;

  return await db.query.shares.findMany({
    orderBy: (shares, { desc }) => [desc(shares.createdAt)],
    limit: limit,
    offset: offset,
    where: eq(shares.userId, userId),
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
}

/**
 * The chat behind a share link, or undefined.
 *
 * Deliberately not scoped to a user: a share link is readable by whoever
 * holds it.
 */
export async function getSharedChat(id: string) {
  const share = await db.query.shares.findFirst({
    where: eq(shares.id, id),
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
}

export async function deleteShare(userId: string, id: string) {
  await db
    .delete(shares)
    .where(and(eq(shares.id, id), eq(shares.userId, userId)));
}

export async function deleteAllShares(userId: string) {
  await db.delete(shares).where(eq(shares.userId, userId));
}
