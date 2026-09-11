import { createFileRoute } from '@tanstack/react-router';
import { del } from '@vercel/blob';

import { getUser } from '@/server/session';

export const Route = createFileRoute('/api/files')({
  server: {
    handlers: { DELETE }
  }
});

async function DELETE({ request: req }: { request: Request }) {
  const user = await getUser();

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url).searchParams.get('url');
  if (!url) {
    return Response.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  const decodedUrl = decodeURIComponent(url);
  const segments = new URL(decodedUrl).pathname.split('/').filter(Boolean);
  // Path structure: {UPLOAD_PATH}/{folder}/{userId}/{filename}
  // userId is always the second-to-last segment
  const userId = segments[segments.length - 2];
  if (!userId || user.id !== userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await del(decodedUrl);

    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: 'Delete failed' }, { status: 500 });
  }
}
