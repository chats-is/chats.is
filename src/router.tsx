import '@/lib/serializable';

import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
import { QueryClient } from '@tanstack/react-query';

import { RouteError } from '@/components/route-error';

import { routeTree } from './routeTree.gen';

export function getRouter() {
  // One client per request on the server, one for the session in the browser.
  // Routes reach it through context, so a loader can prime the same cache the
  // components below it will read from.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // No blanket freshness window. One was kept here to stop a page from
        // asking again the moment it hydrated, but it answered for every
        // query alike — settings, the model catalogue, the history, the
        // library — and they go out of date at wildly different rates. What it
        // bought was a saved request; what it cost was every page quietly
        // showing what it had last seen, with nothing to make it look again.
        // Opening a page asks. A query that really is settled can say so where
        // it is defined.
        //
        // Coming back to the tab is not a request for fresh data. It reloads
        // lists under the reader's cursor, restarts work a dialog was in the
        // middle of, and asks the database for everything on screen at once —
        // for data that changes when someone changes it, not while nobody is
        // looking. Several components had already turned this off one at a
        // time; it is one decision, so it is made once.
        refetchOnWindowFocus: false
      }
    }
  });

  const router = createTanStackRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: 'intent',
    // Start the moment the pointer lands, rather than after the usual pause:
    // the thing being preloaded is the conversation a click is about to ask
    // for, and half a hover is the difference between it being ready and not.
    defaultPreloadDelay: 0,
    // A route's pending state is held back for a moment so a fast load does
    // not flash a placeholder, but a whole second of nothing reads as a click
    // that did not register. Long enough to skip the flash, short enough that
    // a slower load says something is happening.
    defaultPendingMs: 150,
    // The root route names this too, which is enough on the client, where an
    // error climbs to the nearest boundary. On the server it does not climb:
    // a match that errored renders its own route's error component or this
    // one, and with neither the router draws an unstyled notice of its own.
    defaultErrorComponent: RouteError
  });

  // Queries a loader resolved on the server travel with the page, so the
  // components below it read from a warm cache instead of asking again.
  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
