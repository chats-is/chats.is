import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { libraryQueries } from '@/server/fn/library';
import { GalleryPending } from '@/components/gallery-skeleton';
import { LibraryView } from '@/components/library-view';

export const Route = createFileRoute('/_chat/library')({
  loader: ({ context }) =>
    context.queryClient.ensureInfiniteQueryData(
      libraryQueries.list({ limit: 24 })
    ),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Library') }] }),
  pendingComponent: () => <GalleryPending title="Library" />,
  component: LibraryView
});
