import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { libraryQueries } from '@/server/functions/library';
import { Skeleton } from '@/components/ui/skeleton';
import { GalleryPending } from '@/components/gallery-skeleton';
import { LibraryView } from '@/components/library-view';

export const Route = createFileRoute('/_chat/library')({
  loader: ({ context }) =>
    context.queryClient.ensureInfiniteQueryData(
      libraryQueries.list({ limit: 24 })
    ),
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
