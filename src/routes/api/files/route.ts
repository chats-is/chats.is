import { createFileRoute } from '@tanstack/react-router';
import { del } from '@vercel/blob';

import { type User } from '@/types';
import { publicEnv } from '@/lib/env.public';
import { UPLOAD_CONFIG } from '@/lib/upload-config';
import { authedRequest } from '@/server/middleware';
import { isOwnBlobUrl } from '@/server/services/blob';

export const Route = createFileRoute('/api/files')({
  server: {
    middleware: [authedRequest],
    handlers: { DELETE }
  }
});

/**
 * Whether `url` is a file this user uploaded: in blob storage, and at exactly
 * the path their uploads are written to — `{prefix}/{folder}/{userId}/{file}`.
 *
 * The whole path is matched, not one segment of it. The user id sitting
 * second from last proves nothing by itself: a separator can be written as
 * `%2F`, which leaves this side counting one segment where storage may count
 * several, so an address can be built that puts the caller's id where it is
 * looked for and someone else's file where it is deleted. An encoded separator
 * has no honest use in a generated name, and is refused outright.
 */
function isOwnUpload(url: string, userId: string): boolean {
  if (!isOwnBlobUrl(url)) return false;

  const { pathname } = new URL(url);
  if (/%2f|%5c/i.test(pathname)) return false;

  return Object.values(UPLOAD_CONFIG).some(({ folder }) => {
    const prefix = `/${[publicEnv.VITE_UPLOAD_PATH, folder, userId]
      .filter(Boolean)
      .join('/')}/`;
    const file = pathname.slice(prefix.length);
    return (
      pathname.startsWith(prefix) && file.length > 0 && !file.includes('/')
    );
  });
}

async function DELETE({
  request: req,
  context
}: {
  request: Request;
  context: { user: User };
}) {
  const { user } = context;

  const url = new URL(req.url).searchParams.get('url');
  if (!url) {
    return Response.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  // `searchParams` has already decoded it; a second pass would mangle a name
  // that contains a `%` of its own, or throw on one.
  if (!isOwnUpload(url, user.id)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await del(url);

    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: 'Delete failed' }, { status: 500 });
  }
}
