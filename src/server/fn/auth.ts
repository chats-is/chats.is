import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';

import { getUser } from '@/server/session';

/**
 * The signed-in user, or null. Used by the route guards, which is why it
 * answers rather than throwing: a guard decides where to send someone, and
 * that decision belongs in the route.
 */
export const requireUser = createServerFn({ method: 'GET' }).handler(async () =>
  getUser()
);

/**
 * The guards read the session through the cache. Resolved once while the first
 * page is rendered and carried to the browser with it, so moving between pages
 * costs nothing — otherwise every click waits on a round trip before the
 * router will even show that it is loading.
 *
 * Safe to hold for a while because a guard is not the security boundary: every
 * server function states its own requirement, and an admin one refuses a
 * request that does not meet it. Signing in and out both reload the page, so
 * the cache never outlives the session it describes.
 */
export const sessionQueries = {
  key: { me: () => ['session', 'me'] as const },
  me: () =>
    queryOptions({
      queryKey: ['session', 'me'] as const,
      queryFn: () => requireUser(),
      staleTime: 5 * 60 * 1000
    })
};
