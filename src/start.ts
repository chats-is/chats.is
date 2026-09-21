import { isNotFound, isRedirect } from '@tanstack/react-router';
import {
  createCsrfMiddleware,
  createMiddleware,
  createStart
} from '@tanstack/react-start';
import { setResponseStatus } from '@tanstack/react-start/server';

import { withRequestScope } from '@/lib/request-cache';
import { PublicError, validationMessage } from '@/server/public-error';

/**
 * One scope per request, so the settings a request consults are read once and
 * then shared by everything below — the system prompt, the title model, the
 * default quota.
 */
const requestScope = createMiddleware({ type: 'request' }).server(({ next }) =>
  withRequestScope(() => next())
);

/**
 * A rendered page carries the reader's conversations and address in it, so it
 * is nobody's to keep a copy of. Vercel keeps none without being told to; a
 * proxy in front of a self-hosted install makes no such promise.
 *
 * Said here rather than as a header rule for every path: a rule that wide also
 * matches the hashed assets, and would take their year-long cache with it.
 */
/**
 * Set on every response, whatever its status.
 *
 * This app runs code a model wrote, in frames of its own making. No other site
 * has a reason to put any page of it in a frame, and one that could would get
 * to choose how the preview frame is sandboxed.
 *
 * Done here rather than as a route rule in the server config, which is where
 * it was first put: those rules are applied only to a response that is 2xx.
 * The redirect to sign in, the not-found page and every refusal went out bare
 * — and an error page is as framable as any other.
 */
const SECURITY_HEADERS = {
  'content-security-policy': "frame-ancestors 'self'",
  'x-frame-options': 'SAMEORIGIN',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin'
};

const privatePages = createMiddleware({ type: 'request' }).server(
  async ({ next }) => {
    const result = await next();
    const { headers } = result.response;

    try {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        if (!headers.has(name)) headers.set(name, value);
      }
    } catch {
      // A response handed on from somewhere else may have headers that cannot
      // be written to. It is served as it came rather than not at all.
    }

    if (
      headers.get('content-type')?.startsWith('text/html') &&
      !headers.has('cache-control')
    ) {
      headers.set('cache-control', 'private, no-store');
    }

    return result;
  }
);

/**
 * Server functions are same-origin RPC endpoints reached with the caller's
 * cookies, so without this another site could invoke one on a signed-in
 * visitor's behalf. The check is the request's own origin headers.
 *
 * The server routes under /api that act on the session are the same kind of
 * endpoint — a chat turn, a speech request, a deleted file — so they are held
 * to it too. Two are not. The OAuth providers return through /api/auth/* from
 * their own origin, which is cross-site by definition, and better-auth does
 * its own checking there. And blob storage reports a finished upload to
 * /api/files/upload from its servers, with no origin to check at all; that
 * route signs nothing without a session.
 */
const UNCHECKED_API = ['/api/auth/', '/api/files/upload'];

const csrf = createCsrfMiddleware({
  filter: ctx => {
    if (ctx.handlerType === 'serverFn') return true;

    const { pathname } = new URL(ctx.request.url);
    return (
      pathname.startsWith('/api/') &&
      // Reads change nothing, and a resumed stream is one of them.
      ctx.request.method !== 'GET' &&
      !UNCHECKED_API.some(path => pathname.startsWith(path))
    );
  }
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

      // An input the schema refused is the caller's mistake, not a failure
      // of ours: it is answered in the schema's own words, and noted rather
      // than reported with a stack as if something had broken.
      const refused = validationMessage(error);
      if (refused) {
        console.warn('[serverFn] input refused:', refused);
        // The error travels in the body either way, and the caller reads it
        // from there. The status is for whatever watches from outside — a log
        // drain, an uptime check — which otherwise sees every failure as 200.
        setResponseStatus(400);
        throw new PublicError(refused);
      }

      console.error('Unhandled server function error:', error);
      setResponseStatus(500);

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
  requestMiddleware: [csrf, privatePages, requestScope],
  functionMiddleware: [publicErrors]
}));
