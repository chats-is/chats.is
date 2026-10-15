import '@tanstack/react-start/server-only';

import { and, asc, count, eq, isNull, lte } from 'drizzle-orm';
import { type z } from 'zod';

import { type ChatMessage } from '@/types';
import { pageWindow } from '@/types/pagination';
import { type sharePageSchema } from '@/types/shared-link';
import { artifactFiles } from '@/lib/document';
import { generateUUID } from '@/lib/utils';
import { db } from '@/db';
import { artifacts, chats, messages, shares } from '@/db/schema';
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
    columns: { id: true, createdAt: true }
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

/**
 * Share one artifact on its own, or hand back the link it already has — as
 * a chat is shared twice by sharing it once. The link opens that artifact
 * and nothing of the chat it is in: the row names the artifact alone.
 */
export async function createArtifactShare(userId: string, artifactId: string) {
  const artifact = await db.query.artifacts.findFirst({
    where: and(eq(artifacts.id, artifactId), eq(artifacts.userId, userId)),
    columns: { id: true }
  });

  if (!artifact) {
    throw new PublicError('Artifact not found');
  }

  const existingShare = await db.query.shares.findFirst({
    where: and(eq(shares.artifactId, artifactId), eq(shares.userId, userId)),
    columns: { id: true, createdAt: true }
  });

  if (existingShare) {
    return existingShare;
  }

  const result = await db
    .insert(shares)
    .values({ id: generateUUID(), artifactId, userId })
    .returning({ id: shares.id, createdAt: shares.createdAt });

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
        },
        artifact: {
          columns: { id: true, title: true, type: true }
        }
      },
      columns: {
        chatId: false,
        artifactId: false,
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
  // A chat's link only: an artifact's opens that artifact and no more.
  const link = await db.query.shares.findFirst({
    where: and(eq(shares.id, id), isNull(shares.artifactId)),
    columns: { userId: true }
  });
  if (!link) return undefined;

  // Only what the person who shared it wrote or was answered with. A chat's
  // rows are its owner's by construction; this is what holds if one ever is
  // not, since nobody reading a share link could tell.
  const owner = link.userId;

  const share = await db.query.shares.findFirst({
    where: and(eq(shares.id, id), isNull(shares.artifactId)),
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
 * One artifact a share link opens, for compiling its preview.
 *
 * The person reading a share link has no session, and the preview of a React
 * artifact is built on the server. So the request names the link and the
 * artifact, and this says whether that pairing is real: the link is that
 * artifact's own, or the artifact is in the chat the link opens — made, either
 * way, by the person who shared it. What comes back is the artifact's own
 * source, so the caller can hold the request to it — a share link is not a
 * licence to compile whatever is sent.
 */
export async function getSharedArtifact(shareId: string, artifactId: string) {
  const link = await db.query.shares.findFirst({
    where: eq(shares.id, shareId),
    columns: { chatId: true, artifactId: true, userId: true }
  });
  if (!link) return undefined;

  const inLink = link.artifactId
    ? eq(artifacts.id, link.artifactId)
    : link.chatId
      ? eq(artifacts.chatId, link.chatId)
      : undefined;
  if (!inLink) return undefined;

  return await db.query.artifacts.findFirst({
    where: and(
      eq(artifacts.id, artifactId),
      inLink,
      eq(artifacts.userId, link.userId)
    ),
    columns: { id: true, content: true }
  });
}

/**
 * The artifact behind an artifact's share link, or undefined — for the page
 * that shows it alone. Nothing of its chat comes with it — not the chat, not
 * the messages, not who made it — but the files it may read.
 */
export async function getSharedArtifactPage(id: string) {
  const link = await db.query.shares.findFirst({
    where: eq(shares.id, id),
    columns: { artifactId: true, userId: true }
  });
  if (!link?.artifactId) return undefined;

  const found = await db.query.artifacts.findFirst({
    where: and(
      eq(artifacts.id, link.artifactId),
      eq(artifacts.userId, link.userId)
    ),
    columns: { userId: false }
  });
  if (!found) return undefined;
  const { chatId, messageId, ...artifact } = found;

  // The files it can read are those attached up to the reply that made it,
  // named as the model was shown them then: a chat runs in the order it was
  // written, and regenerating cuts away what came after.
  const reply = await db.query.messages.findFirst({
    where: eq(messages.id, messageId),
    columns: { createdAt: true }
  });
  const before: ChatMessage[] = reply
    ? await db
        .select({
          id: messages.id,
          role: messages.role,
          parts: messages.parts
        })
        .from(messages)
        .where(
          and(
            eq(messages.chatId, chatId),
            lte(messages.createdAt, reply.createdAt)
          )
        )
        .orderBy(asc(messages.createdAt))
    : [];

  return { artifact, files: artifactFiles(before) };
}

export async function deleteShare(userId: string, id: string) {
  await db
    .delete(shares)
    .where(and(eq(shares.id, id), eq(shares.userId, userId)));
}

export async function deleteAllShares(userId: string) {
  await db.delete(shares).where(eq(shares.userId, userId));
}
