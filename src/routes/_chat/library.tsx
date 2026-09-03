import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { libraryQueries } from '@/server/fn/library';
import { RoutePending } from '@/components/route-pending';
import { LibraryView } from '@/components/library-view';

export const Route = createFileRoute('/_chat/library')({
  loader: ({ context }) =>
    context.queryClient.ensureInfiniteQueryData(
      libraryQueries.list({ limit: 24 })
    ),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Library') }] }),
  pendingComponent: RoutePending,
  component: LibraryView
});
