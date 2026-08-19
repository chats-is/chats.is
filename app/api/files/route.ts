import { NextRequest, NextResponse } from 'next/server';
import { del } from '@vercel/blob';

import { getVerifiedSession } from '@/server/auth';

export async function DELETE(req: NextRequest) {
  const session = await getVerifiedSession();

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json(
      { error: 'Missing url parameter' },
      { status: 400 }
    );
  }

  const decodedUrl = decodeURIComponent(url);
  const segments = new URL(decodedUrl).pathname.split('/').filter(Boolean);
  // Path structure: {UPLOAD_PATH}/{folder}/{userId}/{filename}
  // userId is always the second-to-last segment
  const userId = segments[segments.length - 2];
  if (!userId || session.user.id !== userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await del(decodedUrl);

    return new Response(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
