import { createFileRoute } from '@tanstack/react-router';

import { libraryQueries } from '@/server/fn/library';
import { LibraryView } from '@/components/library-view';

export const Route = createFileRoute('/_chat/library')({
  loader: ({ context }) =>
    context.queryClient.ensureInfiniteQueryData(
      libraryQueries.list({ limit: 24 })
    ),
  head: () => ({ meta: [{ title: 'Library' }] }),
  component: LibraryView
});
