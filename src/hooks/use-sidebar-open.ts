import { useCallback, useState } from 'react';
import { createIsomorphicFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';

/** The cookie the sidebar's open state is kept in, in the reader's browser. */
const SIDEBAR_COOKIE = 'sidebar-open';
/** A week, as the sidebar keeps it. */
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/**
 * Read from the cookie on whichever side renders, so the server already
 * draws the sidebar the way it was left and the page does not fold it away
 * after loading. Open until the reader closes it.
 */
const readSidebarOpen = createIsomorphicFn()
  .server(() => getCookie(SIDEBAR_COOKIE) !== 'false')
  .client(
    () => !document.cookie.split('; ').includes(`${SIDEBAR_COOKIE}=false`)
  );

/** Whether the sidebar is open, and the setter that remembers it. */
export function useSidebarOpen() {
  const [open, setOpen] = useState(readSidebarOpen);

  const changeOpen = useCallback((next: boolean) => {
    setOpen(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
  }, []);

  return [open, changeOpen] as const;
}
