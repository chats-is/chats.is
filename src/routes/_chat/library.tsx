import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { libraryQueries } from '@/server/functions/library';
import { Skeleton } from '@/components/ui/skeleton';
import { GalleryPending } from '@/components/gallery-skeleton';
import { LibraryView } from '@/components/library-view';

export const Route = createFileRoute('/_chat/library')({
  // Asked for again on every visit, and only the first page: the gallery opens
  // at the top, so the pages scrolled through last time are not worth waiting
  // for before it can be drawn.
  loader: ({ context }) =>
    context.queryClient.fetchInfiniteQuery({
      ...libraryQueries.list({ limit: 24 }),
      pages: 1
    }),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Library') }] }),
  // One search box, and nothing conditional about it — no component needed
  // to say so.
  pendingComponent: () => (
    <GalleryPending
      title="Library"
      toolbar={<Skeleton className="h-9 w-full rounded-full" />}
    />
  ),
  component: LibraryView
});
