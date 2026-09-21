import '@tanstack/react-start/server-only';

import { del } from '@vercel/blob';
import { and, eq, isNotNull, sql, type SQL } from 'drizzle-orm';

import { isTrustedMediaUrl } from '@/lib/chat-media-urls';
import { publicEnv } from '@/lib/env.public';
import { db } from '@/db';
import { artifacts, messages, prompts, users } from '@/db/schema';

/**
 * Whether `url` is a file in this install's own blob store.
 *
 * `isTrustedMediaUrl` can only ask whether an address is in *a* Vercel Blob
 * store, because it is shared with the browser and the browser does not know
 * which store is ours. Anyone can have a store. The server does know: the
 * store's id is the fourth part of the token it writes with, and the store
 * answers at that id's subdomain — the SDK reads the id the same way.
 *
 * A token that does not parse leaves the looser check standing rather than
 * refusing every file the app has ever stored.
 */
export function isOwnBlobUrl(url: string): boolean {
  if (!isTrustedMediaUrl(url)) return false;

  const [, , , storeId = ''] = (process.env.BLOB_READ_WRITE_TOKEN ?? '').split(
    '_'
  );
  if (!storeId) return true;

  return (
    new URL(url).hostname ===
    `${storeId.toLowerCase()}.public.blob.vercel-storage.com`
  );
}

/**
 * Whether `url` is a file of this user's: in our store, at exactly the shape
 * every upload and generation is written to — `{prefix}/{folder}/{userId}/{file}`.
 *
 * The whole path, not "the id appears somewhere in it". A path is made of
 * whatever the uploader named, and an id that merely occurs as a segment says
 * nothing about whose folder the file is in.
 */
export function isUsersOwnFile(url: string, userId: string): boolean {
  if (!isOwnBlobUrl(url)) return false;

  const { pathname } = new URL(url);
  if (/%2f|%5c/i.test(pathname)) return false;

  const prefix = publicEnv.VITE_UPLOAD_PATH
    ? `/${publicEnv.VITE_UPLOAD_PATH}/`
    : '/';
  if (!pathname.startsWith(prefix)) return false;

  const [folder, owner, file, ...rest] = pathname
    .slice(prefix.length)
    .split('/');
  return Boolean(folder && file) && owner === userId && rest.length === 0;
}

/** Whether every file a message carries is one this install stored. */
export function carriesOnlyOwnFiles(parts: Array<{ type: string }>): boolean {
  return parts.every(
    part =>
      part.type !== 'file' || isOwnBlobUrl((part as { url?: string }).url ?? '')
  );
}

/** `db`, or the transaction the caller is in — a read made beside an open
 *  transaction waits on a second connection, and does not see its writes. */
type Executor = Pick<typeof db, 'execute' | 'selectDistinct'>;

/**
 * The files behind a set of messages: what was attached to them, what their
 * tools produced, and what their artifacts point at.
 *
 * Read in SQL, from the `parts` JSON, because the caller is about to delete
 * those rows and may be deleting every message a user ever sent — not
 * something to pull into memory to look through. `which` selects the
 * messages, and is written against the `message` table.
 */
export async function blobUrlsOfMessages(
  which: SQL,
  executor: Executor = db
): Promise<string[]> {
  const inParts = await executor.execute<{ url: string | null }>(sql`
    select distinct found.url
    from ${messages},
    lateral (
      select jsonb_path_query(${messages.parts}, '$[*] ? (@.type == "file").url') #>> '{}' as url
      union all
      select jsonb_path_query(${messages.parts}, '$[*].output.url') #>> '{}'
    ) found
    where ${which}
  `);

  const onArtifacts = await executor
    .selectDistinct({ url: artifacts.fileUrl })
    .from(artifacts)
    .innerJoin(messages, eq(artifacts.messageId, messages.id))
    .where(and(which, isNotNull(artifacts.fileUrl)));

  return [
    ...new Set(
      [...inParts.rows, ...onArtifacts]
        .map(row => row.url)
        .filter((url): url is string => typeof url === 'string')
    )
  ];
}

/**
 * Remove files from storage once the rows that pointed at them are gone.
 *
 * Deleting a chat used to delete its rows and leave its files — public
 * addresses that go on answering for ever, which is not what "remove your data
 * from our servers" says. Called after the rows are deleted, never before: a
 * file with no row is clutter, a row with no file is a broken conversation.
 *
 * Only files this user's own uploads and generations live under are touched,
 * whatever addresses the rows held. And a file something else of theirs still
 * points at is kept — the same attachment can be named by more than one
 * message, and only the last of them to go takes the file with it.
 *
 * Never throws. The deletion the user asked for has already happened; storage
 * being unreachable is a reason to log, not to tell them it failed.
 */
export async function removeBlobs(userId: string, urls: string[]) {
  try {
    const own = urls.filter(url => isUsersOwnFile(url, userId));
    if (own.length === 0) return;

    const orphaned: string[] = [];
    for (const url of own) {
      const [inMessage] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.userId, userId),
            sql`position(${url} in ${messages.parts}::text) > 0`
          )
        )
        .limit(1);
      if (inMessage) continue;

      const [onArtifact] = await db
        .select({ id: artifacts.id })
        .from(artifacts)
        .where(and(eq(artifacts.userId, userId), eq(artifacts.fileUrl, url)))
        .limit(1);
      if (onArtifact) continue;

      // A message can name any file of its owner's — their avatar, a picture
      // on one of their prompts — and deleting the chat must not take those.
      const [asAvatar] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.image, url)))
        .limit(1);
      if (asAvatar) continue;

      const [onPrompt] = await db
        .select({ id: prompts.id })
        .from(prompts)
        .where(eq(prompts.image, url))
        .limit(1);
      if (!onPrompt) orphaned.push(url);
    }

    if (orphaned.length > 0) await del(orphaned);
  } catch (err) {
    console.error('[blob] failed to remove files:', err);
  }
}
