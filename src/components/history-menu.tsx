import { Link, useParams } from '@tanstack/react-router';
import { History } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useChatsInfinite } from '@/hooks/use-chats';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The history while the sidebar is collapsed and its list is out of sight:
 * an icon that opens the same chats beside it, newest first, read further as
 * it is scrolled to the end.
 */
export function HistoryMenu() {
  const params = useParams({ strict: false });
  const {
    chats,
    isLoading,
    isValidating,
    isLoadingMore,
    hasMore,
    isError,
    fetchNextPage
  } = useChatsInfinite();

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (isLoading || isValidating || !hasMore) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      fetchNextPage();
    }
  };

  return (
    <SidebarMenuItem className="hidden group-data-[collapsible=icon]:block">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            tooltip="History"
            className="hover:bg-background hover:shadow-sm data-[state=open]:bg-background data-[state=open]:shadow-sm dark:hover:bg-accent dark:data-[state=open]:bg-accent"
          >
            <History />
            <span>History</span>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="start"
          className="max-h-[min(32rem,var(--radix-dropdown-menu-content-available-height))] w-64"
          onScroll={handleScroll}
        >
          {isLoading && <PlaceholderRows count={5} />}
          {!isLoading && isError && (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              Failed to load chats. Please try again.
            </p>
          )}
          {!isLoading && !isError && chats.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              No chat history
            </p>
          )}
          {chats.map(chat => (
            <DropdownMenuItem
              key={chat.id}
              className={cn(chat.id === params.chatId && 'bg-accent')}
              asChild
            >
              <Link to="/chat/$chatId" params={{ chatId: chat.id }}>
                <span className="truncate">{chat.title}</span>
              </Link>
            </DropdownMenuItem>
          ))}
          {isLoadingMore && <PlaceholderRows count={3} />}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

/** Rows in outline, the height of a chat's, while chats are read. */
function PlaceholderRows({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <div key={index} className="px-2 py-2" aria-hidden>
      <Skeleton className="h-4 w-4/5" />
    </div>
  ));
}
