import {
  type FetchInfiniteQueryOptions,
  type FetchQueryOptions,
  type InfiniteData,
  type QueryClient
} from '@tanstack/react-query';

/**
 * Load the query a page is about to read, for the visit that is happening.
 *
 * A page opens from what is already held and is brought up to date behind the
 * scenes: the read is started here and not waited for, and the component
 * reading the same key redraws when it lands. Only with nothing held at all is
 * there something to wait for, and then the page waits — drawn once, with
 * data, rather than empty and then filled.
 *
 * Staying on a page — another page of the table, a filter, a letter typed into
 * search — never waits, held or not: the rows on screen stay where they are
 * while the next ones load, and a loader that waited would swap them for a
 * placeholder on every keystroke. `cause` is the router's word for it, and it
 * goes by the route, so a change of search on the same page is staying.
 */
export function loadForVisit<TData, TKey extends ReadonlyArray<unknown>>(
  queryClient: QueryClient,
  options: FetchQueryOptions<TData, Error, TData, TKey>,
  cause: 'enter' | 'stay' | 'preload'
): Promise<TData | void> {
  const held = queryClient.getQueryData(options.queryKey) !== undefined;

  if (cause === 'stay' || held) {
    // Started, and not handed back. A promise returned from a loader is one
    // the router waits on — returning this one would make the page wait out
    // its request behind the placeholder, which is what a first visit does.
    void queryClient.prefetchQuery(options);
    return Promise.resolve();
  }
  return queryClient.fetchQuery(options);
}

/**
 * For the two galleries — the library and the prompts — which open from what
 * is already held and are brought up to date behind the page. Spread into the
 * route's `loader` beside its `handler`, with `openGallery` as the handler.
 *
 * This is the router's own default, and is said out loud on these two routes
 * because of what they hold: a list that only grows at the top. Out of date
 * means a new item is missing for a moment, never that something shown is
 * wrong — and they are pages a reader flicks to and from, where a wait was the
 * whole cost.
 */
export const OPEN_FROM_CACHE = { staleReloadMode: 'background' } as const;

/**
 * Make sure a gallery has something to draw, without waiting if it does.
 *
 * With nothing held, this waits for the first page. With anything held it
 * returns at once; the component reading the same key refetches it on mount,
 * since by then it is more than two seconds old, and redraws when that lands.
 *
 * What is held is cut back to its first page on the way in. A gallery opens at
 * the top, and an infinite query refetches every page it holds, one after the
 * other — so coming back to a library scrolled ten pages deep would ask for
 * all ten again to refresh the first. The entry keeps its age when it is cut:
 * trimmed is not refreshed, and must not pass for it, or the refetch that
 * brings the new items in would never happen.
 */
export async function openGallery<
  TPage,
  TKey extends ReadonlyArray<unknown>,
  TPageParam
>(
  queryClient: QueryClient,
  options: FetchInfiniteQueryOptions<TPage, Error, TPage, TKey, TPageParam>
): Promise<void> {
  type Pages = InfiniteData<TPage, TPageParam>;
  const held = queryClient.getQueryData<Pages>(options.queryKey);

  if (!held) {
    await queryClient.fetchInfiniteQuery(options);
    return;
  }

  if (held.pages.length > 1) {
    queryClient.setQueryData<Pages>(
      options.queryKey,
      {
        pages: held.pages.slice(0, 1),
        pageParams: held.pageParams.slice(0, 1)
      },
      { updatedAt: queryClient.getQueryState(options.queryKey)?.dataUpdatedAt }
    );
  }
}
