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
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton key={index} className="aspect-square rounded-lg" />
      ))}
    </div>
  );
}

/**
 * What those pages show while their loader runs.
 *
 * A route's pending component stands in for the whole page, so a bare
 * "Loading..." throws away the header and the layout with it — the page
 * appears to vanish and come back rather than to fill in. This renders the
 * same shell the loaded page does, down to the title, and only the cards are
 * placeholders. Nothing moves when the data lands.
 */
export function GalleryPending({ title }: { title: string }) {
  return (
    <div className="flex size-full flex-col">
      <ChatHeader title={title} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl p-4">
          <GalleryGridSkeleton />
        </div>
      </div>
    </div>
  );
}
