import '@tanstack/react-start/server-only';

import { and, count, eq } from 'drizzle-orm';
import { type z } from 'zod';

import { pageWindow } from '@/types/pagination';
import { type sharePageSchema } from '@/types/shared-link';
import { generateUUID } from '@/lib/utils';
import { db } from '@/db';
import { artifacts, chats, shares } from '@/db/schema';
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

/** One page of the user's own share links, and how many they have in all. */
export async function listShares(
  userId: string,
  input: z.infer<typeof sharePageSchema>
) {
  const owner = eq(shares.userId, userId);

  const [rows, [totalRow]] = await Promise.all([
    db.query.shares.findMany({
      // `id` last so the order is total: shares created together share a
      // timestamp, and offset paging over an order that leaves ties unbroken
      // can repeat a row on one page and skip it on the next.
      orderBy: (shares, { asc, desc }) => [
        desc(shares.createdAt),
        asc(shares.id)
      ],
      ...pageWindow(input),
      where: owner,
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
    }),
    db.select({ count: count() }).from(shares).where(owner)
  ]);

  return {
    rows,
    total: Number(totalRow?.count ?? 0),
    page: input.page,
    pageSize: input.pageSize
  };
}

/**
 * The chat behind a share link, or undefined.
 *
 * Deliberately not scoped to a user: a share link is readable by whoever
 * holds it.
 */
export async function getSharedChat(id: string) {
  const link = await db.query.shares.findFirst({
    where: eq(shares.id, id),
    columns: { userId: true }
  });
  if (!link) return undefined;

  // Only what the person who shared it wrote or was answered with. A chat's
  // rows are its owner's by construction; this is what holds if one ever is
  // not, since nobody reading a share link could tell.
  const owner = link.userId;

  const share = await db.query.shares.findFirst({
    where: eq(shares.id, id),
    with: {
      chat: {
        with: {
          messages: {
            where: (messages, { eq }) => eq(messages.userId, owner),
            orderBy: (messages, { asc }) => [asc(messages.createdAt)],
            columns: {
              chatId: false,
              userId: false
            }
          },
          artifacts: {
            where: (artifacts, { eq }) => eq(artifacts.userId, owner),
            orderBy: (artifacts, { asc }) => [asc(artifacts.createdAt)],
            columns: {
              userId: false
            }
          }
        },
        columns: {
          userId: false,
          streamId: false
        }
      }
    }
  });

  return share?.chat;
}

/**
 * One artifact of a shared chat, for compiling its preview.
 *
 * The person reading a share link has no session, and the preview of a React
 * artifact is built on the server. So the request names the link and the
 * artifact, and this says whether that pairing is real: the artifact is in
 * the chat the link opens, and was made by the person who shared it. What
 * comes back is the artifact's own source, so the caller can hold the request
 * to it — a share link is not a licence to compile whatever is sent.
 */
export async function getSharedArtifact(shareId: string, artifactId: string) {
  const link = await db.query.shares.findFirst({
    where: eq(shares.id, shareId),
    columns: { chatId: true, userId: true }
  });
  if (!link) return undefined;

  return await db.query.artifacts.findFirst({
    where: and(
      eq(artifacts.id, artifactId),
      eq(artifacts.chatId, link.chatId),
      eq(artifacts.userId, link.userId)
    ),
    columns: { id: true, content: true }
  });
}

export async function deleteShare(userId: string, id: string) {
  await db
    .delete(shares)
    .where(and(eq(shares.id, id), eq(shares.userId, userId)));
}

export async function deleteAllShares(userId: string) {
  await db.delete(shares).where(eq(shares.userId, userId));
}
