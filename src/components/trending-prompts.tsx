import { useEffect, useState, type RefObject } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';

import { setPendingPrompt } from '@/lib/pending-prompt';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import {
  promptQueries,
  type listUsablePrompts
} from '@/server/functions/prompt';
import {
  GalleryCardSkeletons,
  GalleryGridSkeleton
} from '@/components/gallery-skeleton';

type UsablePrompt = Awaited<ReturnType<typeof listUsablePrompts>>[number];

/** Card for a single prompt — clicking seeds it into a fresh chat composer. */
function PromptCard({ prompt }: { prompt: UsablePrompt }) {
  const router = useRouter();

  const handleUse = () => {
    setPendingPrompt(prompt.content);
    // refresh() forces a fresh `/` render (new chat id → remount) so the
    // seeding effect re-runs even when `/` is served from the router cache,
    // matching how NewContent navigates.
    router.navigate({ to: '/' });
    router.invalidate();
  };

  return (
    <button
      type="button"
      onClick={handleUse}
      title={prompt.name}
      className="group relative flex aspect-square flex-col overflow-hidden rounded-2xl border bg-background text-left transition hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden"
    >
      {prompt.image ? (
        <>
          <img
            src={prompt.image}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/70 to-transparent p-2">
            <span className="line-clamp-2 text-xs text-white">
              {prompt.name}
            </span>
          </div>
        </>
      ) : (
        <>
          <p className="line-clamp-[10] min-h-0 flex-1 overflow-hidden p-3 text-xs whitespace-pre-wrap text-muted-foreground">
            {prompt.content}
          </p>
          <div className="px-3 pb-2.5">
            <span className="line-clamp-2 text-xs font-medium">
              {prompt.name}
            </span>
          </div>
        </>
      )}
    </button>
  );
}

/** One row of the widest grid, so a page on its way reads as a row of cards. */
const NEXT_PAGE_PLACEHOLDER_CARDS = 4;

/** Everyone's shared prompts plus your own — click one to use it in a new chat.
 *  `scrollRef` is the page's own scroll container, not a container of its own:
 *  infinite scroll has to watch the element that actually scrolls. `search`
 *  comes from the shared toolbar above, and is debounced here before it
 *  reaches the server. */
export function TrendingPrompts({
  active,
  scrollRef,
  search
}: {
  active: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  search: string;
}) {
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery(
      promptQueries.usableInfinite({
        limit: 24,
        search: debouncedSearch || undefined
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
        <Sparkles className="size-12 opacity-50" />
        <p className="text-sm">
          {debouncedSearch
            ? 'No prompts match your search.'
            : 'Prompts you and your team create will appear here.'}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {prompts.map(prompt => (
        <PromptCard key={prompt.id} prompt={prompt} />
      ))}
      {/* The page being fetched, in the grid it is joining. */}
      {isFetchingNextPage && (
        <GalleryCardSkeletons count={NEXT_PAGE_PLACEHOLDER_CARDS} />
      )}
    </div>
  );
}
