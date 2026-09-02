import { useCallback, useEffect, useRef } from 'react';
import { compareDesc } from 'date-fns';
import { Loader2 } from 'lucide-react';

import { useChatsInfinite } from '@/hooks/use-chats';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu
} from '@/components/ui/sidebar';
import { SidebarItem } from '@/components/sidebar-item';

export function SidebarList() {
  const listRef = useRef<HTMLDivElement>(null);
  const { chats, isLoading, isValidating, hasMore, isError, fetchNextPage } =
    useChatsInfinite();

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
        <div className="flex size-full items-center justify-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
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
        <>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {sortedChats.map(chat => (
                  <SidebarItem key={chat.id} chat={chat} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          {isValidating && hasMore && (
            <div className="flex justify-center py-2">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
