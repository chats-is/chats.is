import '@tanstack/react-start/server-only';

import { getRequestHeaders } from '@tanstack/react-start/server';

import { type User } from '@/types';

import { auth } from './auth';

/**
 * The signed-in user for the request being served, or null.
 *
 * `role` comes off the user row that better-auth resolves for the session, so
 * revoking admin takes effect on the next request rather than when a token
 * would have expired.
 */
export async function getUser(headers?: Headers): Promise<User | null> {
  const session = await auth.api.getSession({
    headers: headers ?? (getRequestHeaders() as unknown as Headers)
  });

  if (!session?.user) return null;

  return {
    id: session.user.id,
    admin: session.user.role === 'admin',
    name: session.user.name,
    email: session.user.email,
    image: session.user.image ?? null
  };
}
