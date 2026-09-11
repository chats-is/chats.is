import { useCallback, useEffect, type RefObject } from 'react';

/** How close to the end counts as having reached it. */
const THRESHOLD_PX = 100;

interface InfiniteScrollOptions {
  /** False while a request is in flight, or when there is nothing more. */
  enabled: boolean;
  onLoadMore: () => void;
}

/**
 * Fetch the next page when a scroll container reaches its end.
 *
 * The alternative is a button, which asks the reader to say twice that they
 * want to keep going: once by scrolling to the bottom, once by clicking.
 */
export function useInfiniteScroll(
  ref: RefObject<HTMLElement | null>,
  { enabled, onLoadMore }: InfiniteScrollOptions
) {
  const handleScroll = useCallback(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < THRESHOLD_PX) {
      onLoadMore();
    }
  }, [ref, enabled, onLoadMore]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [ref, handleScroll]);

  // A page that does not fill the window leaves nothing to scroll, and a
  // scroll is the only thing asking for the next one — so on a tall screen the
  // rest of the list would be unreachable. Deliberately without a dependency
  // list: it runs after every render and stops on its own, since `enabled` is
  // false while a page is in flight and once there are no more.
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    if (el.scrollHeight <= el.clientHeight) onLoadMore();
  });
}
