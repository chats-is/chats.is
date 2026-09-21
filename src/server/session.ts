import '@tanstack/react-start/server-only';

import { getRequestHeaders } from '@tanstack/react-start/server';

import { type User } from '@/types';
import { perRequest } from '@/lib/request-cache';

import { auth } from './auth';

/**
 * The signed-in user for the request being served, or null.
 *
 * `role` comes off the user row that better-auth resolves for the session, so
 * revoking admin takes effect on the next request rather than when a token
 * would have expired.
 *
 * Asked once per request. A rendered page runs its guard and each of its
 * loaders in the one request, and every one of them begins here; the answer
 * cannot change between them, and each asking was a query of its own.
 */
export const getUser = perRequest('getUser', async (): Promise<User | null> => {
  const session = await auth.api.getSession({
    headers: getRequestHeaders()
  });

  if (!session?.user) return null;

  return {
    id: session.user.id,
    admin: session.user.role === 'admin',
    name: session.user.name,
    email: session.user.email,
    image: session.user.image ?? null
  };
});
