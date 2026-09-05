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
        // The server already fetched what a loader asked for; refetching it the
        // moment the page hydrates would throw that away.
        staleTime: 30 * 1000
      }
    }
  });

  const router = createTanStackRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: 'intent',
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
