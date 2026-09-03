import {
  createCsrfMiddleware,
  createMiddleware,
  createStart
} from '@tanstack/react-start';

import { withRequestScope } from '@/lib/request-cache';

/**
 * One scope per request, so the settings a request consults are read once and
 * then shared by everything below — the system prompt, the title model, the
 * default quota.
 */
const requestScope = createMiddleware({ type: 'request' }).server(({ next }) =>
  withRequestScope(() => next())
);

/**
 * Server functions are same-origin RPC endpoints reached with the caller's
 * cookies, so without this another site could invoke one on a signed-in
 * visitor's behalf. The check is the request's own origin headers.
 *
 * Scoped to server functions because the routes are a different matter: the
 * OAuth providers return through /api/auth/* from their own origin, which is
 * cross-site by definition, and better-auth does its own checking there.
 */
const csrf = createCsrfMiddleware({
  filter: ctx => ctx.handlerType === 'serverFn'
});

export const startInstance = createStart(() => ({
  // CSRF first: a refused request should not open a scope.
  requestMiddleware: [csrf, requestScope]
}));
