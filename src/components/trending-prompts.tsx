import { useEffect, useState, type RefObject } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Copy, SquareSparkles } from 'lucide-react';

import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import { promptQueries } from '@/server/functions/prompt';
import {
  GalleryCardSkeletons,
  GalleryGridSkeleton
} from '@/components/gallery-skeleton';
import { PromptCard } from '@/components/prompt-card';

/** One row of the widest grid, so a page on its way reads as a row of cards. */
const NEXT_PAGE_PLACEHOLDER_CARDS = 4;

/** Everyone's shared prompts plus your own — click one to use it in a new chat.
 *  `scrollRef` is the page's own scroll container, not a container of its own:
 *  infinite scroll has to watch the element that actually scrolls. `search`
 *  comes from the shared toolbar above, and is debounced here before it
 *  reaches the server; `tag` is the one the page is narrowed to, and `onTag`
 *  is a card's tag being picked. */
export function TrendingPrompts({
  active,
  scrollRef,
  search,
  tag,
  onTag
}: {
  active: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  search: string;
  tag?: string;
  onTag: (tag: string) => void;
}) {
  const { copyToClipboard } = useCopyToClipboard();
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery(
      promptQueries.usableInfinite({
        limit: 24,
        search: debouncedSearch || undefined,
        tag
      })
    );

  useInfiniteScroll(scrollRef, {
    enabled: active && !!hasNextPage && !isFetchingNextPage && !isLoading,
    onLoadMore: fetchNextPage
  });

  const prompts = data?.pages.flat() ?? [];

  if (isLoading) {
    return <GalleryGridSkeleton />;
  }

  if (!prompts.length) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
        <SquareSparkles className="size-12 opacity-50" />
        <p className="text-sm">
          {debouncedSearch || tag
            ? 'No prompts match your search.'
            : 'Prompts you and your team create will appear here.'}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {prompts.map(prompt => (
        <PromptCard
          key={prompt.id}
          prompt={prompt}
          activeTag={tag}
          onTag={onTag}
          actions={[
            {
              label: 'Copy',
              icon: Copy,
              onClick: () => copyToClipboard(prompt.content)
            }
          ]}
        />
      ))}
      {/* The page being fetched, in the grid it is joining. */}
      {isFetchingNextPage && (
        <GalleryCardSkeletons count={NEXT_PAGE_PLACEHOLDER_CARDS} />
      )}
    </div>
  );
}
