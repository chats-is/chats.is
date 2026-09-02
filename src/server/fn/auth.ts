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
