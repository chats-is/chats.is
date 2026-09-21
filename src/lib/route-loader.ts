import {
  type FetchQueryOptions,
  type QueryClient
} from '@tanstack/react-query';

/**
 * Load the query a page is about to read, for the visit that is happening.
 *
 * Arriving at a page waits for it, so the page is drawn once and with data.
 * Staying on it — another page of the table, a filter, a letter typed into
 * search — does not: the rows already on screen stay where they are while the
 * next ones load, and a loader that waited would swap them for a placeholder
 * on every keystroke. `cause` is the router's word for which of the two this
 * is, and it goes by the route, so a change of search on the same page stays.
 */
export function loadForVisit<TData, TKey extends ReadonlyArray<unknown>>(
  queryClient: QueryClient,
  options: FetchQueryOptions<TData, Error, TData, TKey>,
  cause: 'enter' | 'stay' | 'preload'
): Promise<TData | void> {
  if (cause === 'stay') {
    // Started, and not handed back. A promise returned from a loader is one
    // the router waits on — returning this one made every page turn wait out
    // its request behind the placeholder, exactly as a first visit does.
    void queryClient.prefetchQuery(options);
    return Promise.resolve();
  }
  return queryClient.fetchQuery(options);
}
