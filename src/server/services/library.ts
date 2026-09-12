import '@tanstack/react-start/server-only';

import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { type z } from 'zod';

import { mediaToolNames } from '@/types';
import { type libraryPageSchema } from '@/types/library';
import { extractLibraryMedia, type LibraryMediaItem } from '@/lib/library';
import { db } from '@/db';
import { artifacts, messages } from '@/db/schema';

/** Cards only render a snippet; the full body is fetched on download. */
const ARTIFACT_PREVIEW_CHARS = 2000;

type ArtifactRow = Omit<typeof artifacts.$inferSelect, 'userId'>;

export type LibraryItem =
  | ({ type: 'media' } & LibraryMediaItem)
  | {
      type: 'artifact';
      id: string;
      /** Artifact row with `content` truncated to the preview length. */
      artifact: ArtifactRow;
      chatId: string | null;
      createdAt: Date;
    };

// Single source: the media tool list lives in types/chat-tools.ts. NOTE: this
// jsonpath also appears in the partial index that accelerates the query
// (db/migrations) — keep them in sync when tools are added.
const MEDIA_PARTS_JSONPATH = `$[*] ? (@.type == "file" || @.type like_regex "^tool-(${mediaToolNames.join('|')})$")`;

/**
 * Merged, time-descending feed of everything the user generated across all
 * chats: media (read straight out of persisted assistant messages) mixed
 * with artifacts. Cursor = ISO timestamp; pages never split a group of
 * items sharing the boundary timestamp (strict `lt` would skip them).
 */

/**
 * One page of the merged, time-descending feed of everything the user
 * generated across all chats: media read straight out of persisted assistant
 * messages, mixed with artifacts.
 *
 * The cursor is an ISO timestamp. A page never splits a group of items sharing
 * the boundary timestamp — a strict `lt` cursor would skip whatever remained
 * of it — so a page can come back slightly longer than `limit`.
 */
export async function readLibraryPage(
  userId: string,
  { cursor, limit }: z.infer<typeof libraryPageSchema>
): Promise<{ items: LibraryItem[]; nextCursor: string | undefined }> {
  const before = cursor ? new Date(cursor) : null;

  // Only messages that actually contain media parts — skips the bulk of
  // plain-text messages before JSON extraction.
  const hasMediaPart = sql`jsonb_path_exists(${messages.parts}, ${sql.raw(`'${MEDIA_PARTS_JSONPATH}'`)})`;

  const [messageRows, artifactRows] = await Promise.all([
    db
      .select({
        id: messages.id,
        chatId: messages.chatId,
        parts: messages.parts,
        createdAt: messages.createdAt
      })
      .from(messages)
      .where(
        and(
          eq(messages.userId, userId),
          eq(messages.role, 'assistant'),
          hasMediaPart,
          before ? lt(messages.createdAt, before) : undefined
        )
      )
      .orderBy(desc(messages.createdAt))
      .limit(limit),
    db
      .select({
        id: artifacts.id,
        chatId: artifacts.chatId,
        messageId: artifacts.messageId,
        title: artifacts.title,
        type: artifacts.type,
        language: artifacts.language,
        // Truncate in SQL — artifact bodies can be large and cards only
        // render a snippet.
        content: sql<
          string | null
        >`left(${artifacts.content}, ${ARTIFACT_PREVIEW_CHARS})`,
        fileUrl: artifacts.fileUrl,
        fileName: artifacts.fileName,
        mimeType: artifacts.mimeType,
        size: artifacts.size,
        createdAt: artifacts.createdAt,
        updatedAt: artifacts.updatedAt
      })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.userId, userId),
          isNotNull(artifacts.messageId),
          before ? lt(artifacts.createdAt, before) : undefined
        )
      )
      .orderBy(desc(artifacts.createdAt))
      .limit(limit)
  ]);

  const media: LibraryItem[] = messageRows
    .flatMap(row => extractLibraryMedia(row))
    .map(item => ({ type: 'media' as const, ...item }));
  const arts: LibraryItem[] = artifactRows.map(row => ({
    type: 'artifact' as const,
    id: row.id,
    artifact: row,
    chatId: row.chatId,
    createdAt: row.createdAt
  }));

  const merged = [...media, ...arts].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );

  // Never cut inside a same-timestamp group: the strict-lt cursor would
  // skip whatever remained of it on the next page (one message can yield
  // several media items, all stamped with the message's createdAt).
  const items = merged.slice(0, limit);
  if (items.length > 0 && merged.length > items.length) {
    const boundary = items[items.length - 1].createdAt.getTime();
    for (
      let i = items.length;
      i < merged.length && merged[i].createdAt.getTime() === boundary;
      i++
    ) {
      items.push(merged[i]);
    }
  }

  // More data likely remains when either source filled its page.
  const hasMore =
    messageRows.length === limit ||
    artifactRows.length === limit ||
    merged.length > items.length;

  // A page can extract zero items (e.g. a stretch of messages whose tool
  // outputs all errored) — keep paginating from the oldest fetched row
  // instead of stopping dead.
  const oldestFetched = Math.min(
    messageRows.length > 0
      ? messageRows[messageRows.length - 1].createdAt.getTime()
      : Infinity,
    artifactRows.length > 0
      ? artifactRows[artifactRows.length - 1].createdAt.getTime()
      : Infinity
  );
  const nextCursor = !hasMore
    ? undefined
    : items.length > 0
      ? items[items.length - 1].createdAt.toISOString()
      : Number.isFinite(oldestFetched)
        ? new Date(oldestFetched).toISOString()
        : undefined;

  return { items, nextCursor };
}
