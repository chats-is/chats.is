import { createMiddleware } from '@tanstack/react-start';

import type { User } from '@/types';

import { getUser } from './session';

/**
 * The three tiers the API is built from. They replace what tRPC's procedure
 * builders gave us, and they say the same three things: anyone may call this,
 * you must be signed in, you must be an admin.
 *
 * A server function reaches for one of these instead of asking for the session
 * itself, so a route that forgets to check can't quietly become public.
 */
export const authedMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const user = await getUser();
    if (!user) {
      throw new Response('Unauthorized', { status: 401 });
    }
    return next({ context: { user } });
  }
);

export const adminMiddleware = createMiddleware({ type: 'function' })
  .middleware([authedMiddleware])
  .server(async ({ next, context }) => {
    if (!context.user.admin) {
      throw new Response('Admin access required', { status: 403 });
    }
    return next({ context: { user: context.user as User } });
  });

/**
 * Signed in or not — the session is handed over either way, because some
 * reads answer differently for a known user without requiring one.
 */
export const optionalAuthMiddleware = createMiddleware({
  type: 'function'
}).server(async ({ next }) => next({ context: { user: await getUser() } }));
