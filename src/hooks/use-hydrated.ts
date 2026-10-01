import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * Whether the page is running in the browser, past hydration.
 *
 * False while the server renders and while the browser takes that HTML
 * over, so both render the same; true from then on, and at once for
 * anything mounted after — a page reached by a link never waits on it.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
