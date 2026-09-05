import { isNotFound, isRedirect } from '@tanstack/react-router';
import {
  createCsrfMiddleware,
  createMiddleware,
  createStart
} from '@tanstack/react-start';

import { withRequestScope } from '@/lib/request-cache';
import { PublicError } from '@/server/public-error';

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

/**
 * What a failed server function is allowed to say.
 *
 * The error a handler throws is serialized and sent to the caller, which is
 * what carries a refusal to its toast. Nothing sorts them, though, so a
 * database that is down answers in the words of the driver — a connection
 * string, a schema name — to whoever provoked it. A share link needs no
 * account, so that is not always someone you know.
 *
 * Anything raised on purpose says so by being a `PublicError` and goes out as
 * written. The rest is logged here, where the whole error still is, and leaves
 * as one sentence that assumes nothing about who is reading.
 *
 * Redirects, not-founds and Responses are control flow rather than failures —
 * the router throws them to steer, and swallowing them would strand the
 * navigation they were steering.
 */
const publicErrors = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    try {
      return await next();
    } catch (error) {
      if (
        error instanceof PublicError ||
        error instanceof Response ||
        isRedirect(error) ||
        isNotFound(error)
      ) {
        throw error;
      }

      console.error('Unhandled server function error:', error);

      // Read per request, not at module scope: env arrives per request under
      // edge SSR, where a module-level read is undefined on the server.
      if (process.env.NODE_ENV !== 'production') {
        // Development keeps the reason. It is the whole of what the error page
        // and the toasts have to show, and there is nobody here to hide it
        // from.
        throw error;
      }

      throw new Error('Something went wrong. Please try again.');
    }
  }
);

export const startInstance = createStart(() => ({
  // CSRF first: a refused request should not open a scope.
  requestMiddleware: [csrf, requestScope],
  functionMiddleware: [publicErrors]
}));
