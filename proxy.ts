import { NextResponse, type NextRequest } from 'next/server';

import { auth } from '@/server/auth';

/**
 * The only thing standing in front of the app's pages. The chat area has no
 * check of its own, so a rejected session has to be turned away here — a
 * signed-out visitor who reaches a rendered page would watch every one of its
 * data calls fail with nothing telling them to sign in again.
 *
 * The session is resolved rather than merely sniffed from the cookie: a cookie
 * can outlive the row it names (the account deleted, or DATABASE_URL
 * repointed), and better-auth answers that question by looking.
 */
export async function proxy(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    const url = new URL('/login', request.url);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|login|share|privacy|artifact-preview-frame|_next/static|_next/image|favicon.svg|manifest.webmanifest|.*\\.png$).*)'
  ]
};
