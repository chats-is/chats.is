import { createServerFn } from '@tanstack/react-start';
import { infiniteQueryOptions } from '@tanstack/react-query';
import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { mediaToolNames } from '@/types';
import { extractLibraryMedia, type LibraryMediaItem } from '@/lib/library';
import { db } from '@/server/db';
import { artifacts, messages } from '@/server/db/schema';
import { authedMiddleware } from '@/server/middleware';

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
// (server/db/migrations) — keep them in sync when tools are added.
const MEDIA_PARTS_JSONPATH = `$[*] ? (@.type == "file" || @.type like_regex "^tool-(${mediaToolNames.join('|')})$")`;

/**
 * Merged, time-descending feed of everything the user generated across all
 * chats: media (read straight out of persisted assistant messages) mixed
 * with artifacts. Cursor = ISO timestamp; pages never split a group of
 * items sharing the boundary timestamp (strict `lt` would skip them).
 */
export const listLibrary = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .validator(
    z.object({
      cursor: z.string().nullish(),
      limit: z.number().min(1).max(60).default(24)
    })
  )
  .handler(async ({ data, context }) => {
    const userId = context.user.id;
    const before = data.cursor ? new Date(data.cursor) : null;

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
        .limit(data.limit),
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
        .limit(data.limit)
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
    const items = merged.slice(0, data.limit);
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
      messageRows.length === data.limit ||
      artifactRows.length === data.limit ||
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
  });

export const libraryQueries = {
  all: () => ['library'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    list: () => ['library', 'list'] as const
  },
  /** The library scrolls; the cursor is the timestamp of the last item shown. */
  list: ({ limit = 24 }: { limit?: number } = {}) =>
    infiniteQueryOptions({
      queryKey: [...libraryQueries.key.list(), limit] as const,
      queryFn: ({ pageParam }) =>
        listLibrary({ data: { cursor: pageParam, limit } }),
      initialPageParam: null as string | null | undefined,
      getNextPageParam: lastPage => lastPage.nextCursor
    })
};
