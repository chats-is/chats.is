import '@/lib/serializable';

import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { isUnauthorized } from '@/lib/auth-error';
import { RouteError } from '@/components/route-error';

import { routeTree } from './routeTree.gen';

/**
 * A session that ended while the page was open. The guards only run on a
 * navigation, so the first to find out is whatever read or edit came next —
 * and all it can do with the refusal is show it. Signing in is a full page
 * load here, as signing out is, so the way back is one too: to the form, with
 * this address to return to.
 */
function onSessionLost(error: unknown) {
  if (typeof window === 'undefined' || !isUnauthorized(error)) return;

  const { pathname, search } = window.location;
  if (pathname === '/login') return;

  window.location.assign(
    `/login?redirect=${encodeURIComponent(pathname + search)}`
  );
}

export function getRouter() {
  // One client per request on the server, one for the session in the browser.
  // Routes reach it through context, so a loader can prime the same cache the
  // components below it will read from.
  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError: onSessionLost }),
    mutationCache: new MutationCache({ onError: onSessionLost }),
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
        // What is left is not a freshness window but the length of one
        // navigation. A loader asks, and the component it was asking for mounts
        // a moment later; with nothing here that mount asks a second time, and
        // a hover that preloaded makes it a third. Two seconds lets one answer
        // serve the visit that fetched it, and is over before the next.
        staleTime: 2 * 1000,
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
    // The galleries start at the top every time they are opened.
    //
    // Restoration is per history entry, so arriving by a link — a new entry —
    // has nothing to restore and would instead inherit the scroll of the page
    // left behind: the router carries each element's position forward, and two
    // pages whose scrollers sit at the same place in the DOM read as the same
    // element. Naming them here says the position is not kept, rather than kept
    // and handed to the wrong page.
    scrollToTopSelectors: [
      '[data-scroll-restoration-id="library"]',
      '[data-scroll-restoration-id="prompts"]'
    ],
    defaultPreload: 'intent',
    // Start the moment the pointer lands, rather than after the usual pause:
    // the thing being preloaded is the conversation a click is about to ask
    // for, and half a hover is the difference between it being ready and not.
    //
    // Not zero, though. At zero a pointer merely crossing the sidebar on its
    // way somewhere else reads every conversation it passes over, messages
    // and artifacts and all. Fifty milliseconds is shorter than any click —
    // the pointer has to stop before a button can be pressed — and longer
    // than a pass, so what is preloaded is what was aimed at.
    defaultPreloadDelay: 50,
    // The router would otherwise hold a preloaded loader's result as fresh for
    // thirty seconds and not run the loader again on the click. Freshness is
    // the query cache's to decide, so every load goes through to it.
    defaultPreloadStaleTime: 0,
    // And the router waits for that load. It keeps the pages it has shown for
    // half an hour, and coming back to one it would otherwise draw it at once
    // and run the loader behind it — so a loader that awaits fresh data awaited
    // it for nobody: the page was already up, reading the last visit's rows out
    // of the query cache, and swapped them a moment later. Opening a page asks,
    // and this is what makes the page wait for the answer.
    //
    // It costs nothing where nothing is asked: a layout that stays put while
    // the page under it changes is not reloaded at all, and a loader that only
    // reads what is already cached returns at once.
    defaultStaleReloadMode: 'blocking',
    // How long a load may take before it is worth saying so. Under this, the
    // placeholder never appears and the page changes once; over it, the
    // placeholder stands in until the data lands.
    //
    // Long enough for a menu or popover to finish closing first: a placeholder
    // that arrives mid-animation takes the whole shell with it, and the menu
    // reappears for a frame on its way out. Short enough that a slow load still
    // answers the click — the framework's own second of nothing does not.
    defaultPendingMs: 300,
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
