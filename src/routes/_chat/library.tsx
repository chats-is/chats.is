import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { OPEN_FROM_CACHE, openGallery } from '@/lib/route-loader';
import { libraryQueries } from '@/server/functions/library';
import { Skeleton } from '@/components/ui/skeleton';
import { GalleryPending } from '@/components/gallery-skeleton';
import { LibraryView } from '@/components/library-view';

export const Route = createFileRoute('/_chat/library')({
  // Opens from what is held and is refreshed behind the page; only a first
  // visit, with nothing held, waits.
  loader: {
    ...OPEN_FROM_CACHE,
    handler: ({ context }) =>
      openGallery(context.queryClient, libraryQueries.list({ limit: 24 }))
  },
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
