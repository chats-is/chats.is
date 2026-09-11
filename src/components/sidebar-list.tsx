import { useCallback, useEffect, useRef } from 'react';
import { compareDesc } from 'date-fns';

import { useChatsInfinite } from '@/hooks/use-chats';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu
} from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { SidebarItem } from '@/components/sidebar-item';

/**
 * The history, in outline, while it is being read.
 *
 * A spinner says only that something is happening; these say what is coming,
 * in the shape it will come in. Titles are what vary in a chat list, so the
 * rows do too.
 */
const PLACEHOLDER_WIDTHS = [
  'w-4/5',
  'w-3/5',
  'w-11/12',
  'w-2/3',
  'w-1/2',
  'w-3/4',
  'w-2/5',
  'w-4/6'
];

/** How many rows stand in for the list before any of it has been read. */
const INITIAL_PLACEHOLDER_ROWS = 8;

/** How many stand at the end for the page being fetched. */
const NEXT_PAGE_PLACEHOLDER_ROWS = 3;

/** `count` rows, laid out exactly as a chat in the list is — and, like a chat,
 *  list items, since that is what the menu around them is made of. */
function PlaceholderRows({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <li
      key={index}
      className="flex w-full items-center gap-2 rounded-md p-2"
      aria-hidden
    >
      <Skeleton className="size-4 shrink-0 rounded-sm" />
      <Skeleton
        className={`h-4 ${PLACEHOLDER_WIDTHS[index % PLACEHOLDER_WIDTHS.length]}`}
      />
    </li>
  ));
}

export function SidebarList() {
  const listRef = useRef<HTMLDivElement>(null);
  const {
    chats,
    isLoading,
    isValidating,
    isLoadingMore,
    hasMore,
    isError,
    fetchNextPage
  } = useChatsInfinite();

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el || isLoading || isValidating || !hasMore) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      fetchNextPage();
    }
  }, [isLoading, isValidating, hasMore, fetchNextPage]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const sortedChats = chats
    ?.filter(chat => chat && chat.createdAt)
    .sort((a, b) => compareDesc(new Date(a.createdAt), new Date(b.createdAt)));

  return (
    <div
      className="flex-1 overflow-auto group-data-[collapsible=icon]:hidden"
      ref={listRef}
    >
      {(isLoading || (isValidating && chats.length === 0)) && (
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <PlaceholderRows count={INITIAL_PLACEHOLDER_ROWS} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
      {!isLoading && isError && (
        <div className="p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Failed to load chats. Please try again.
          </p>
        </div>
      )}
      {!isLoading && !isValidating && !isError && chats.length === 0 && (
        <div className="p-8 text-center">
          <p className="text-sm text-muted-foreground">No chat history</p>
        </div>
      )}
      {chats.length > 0 && (
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {sortedChats.map(chat => (
                <SidebarItem key={chat.id} chat={chat} />
              ))}
              {/* The page being fetched, at the end of the list it is joining. */}
              {isLoadingMore && (
                <PlaceholderRows count={NEXT_PAGE_PLACEHOLDER_ROWS} />
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </div>
  );
}
