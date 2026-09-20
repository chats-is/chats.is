import { useSearch } from '@tanstack/react-router';

import { Skeleton } from '@/components/ui/skeleton';
import { ChatHeader } from '@/components/chat-header';

/**
 * The grid of square cards that Library and Prompts are both made of, drawn
 * as placeholders.
 *
 * Eight of them: enough to fill the fold at every column count the grid uses,
 * without promising a page that turns out to hold three.
 */
export function GalleryGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      <GalleryCardSkeletons count={8} />
    </div>
  );
}

/**
 * The cards alone, for a grid that already exists — the page being fetched,
 * taking its place at the end of the one on screen.
 */
export function GalleryCardSkeletons({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <Skeleton key={index} className="aspect-square rounded-2xl" aria-hidden />
  ));
}

/**
 * What those pages show while their loader runs.
 *
 * A route's pending component stands in for the whole page, so a bare
 * "Loading..." throws away the header and the layout with it — the page
 * appears to vanish and come back rather than to fill in. This renders the
 * same shell the loaded page does, down to the title, and only the cards are
 * placeholders. Nothing moves when the data lands.
 *
 * `toolbar` is for a gallery that keeps a row of controls above its grid.
 * Library has none, and `space-y-4` over a single child costs it nothing.
 */
export function GalleryPending({
  title,
  toolbar
}: {
  title: string;
  toolbar?: React.ReactNode;
}) {
  return (
    <div className="flex size-full flex-col">
      <ChatHeader title={title} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
          {toolbar}
          <GalleryGridSkeleton />
        </div>
      </div>
    </div>
  );
}

/**
 * The row Prompts keeps above its grid: which tab is open, a search box, and
 * — on My Prompts only — the button that opens the new-prompt dialog. Leaving
 * it out drew the grid a row and a gap too high, so the whole page dropped the
 * moment the prompts arrived.
 *
 * Which tab is open is the address's answer, and it is answered before the
 * loader runs, so the Add Prompt placeholder is there exactly when the button
 * will be. Read loosely rather than through the route, which imports this
 * file.
 */
export function PromptsToolbarSkeleton() {
  const view = useSearch({ strict: false }).tab ?? 'trending';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* The two tab pills, as one bar: they are a fixed pair, so this is
          their width rather than a guess at it. */}
      <Skeleton className="h-9 w-48 shrink-0 rounded-full" />
      <Skeleton className="h-9 min-w-40 flex-1 rounded-full" />
      {view === 'my' && <Skeleton className="h-9 w-32 shrink-0 rounded-full" />}
    </div>
  );
}
