import '@/lib/serializable';

import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
import { QueryClient } from '@tanstack/react-query';

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
    defaultPreload: 'intent'
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
