import '@/lib/serializable';

import { QueryClient } from '@tanstack/react-query';
import { routerWithQueryClient } from '@tanstack/react-router-with-query';
import { createRouter as createTanStackRouter } from '@tanstack/react-router';

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
    defaultPreloadStaleTime: 0
  });

  return routerWithQueryClient(router, queryClient);
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
