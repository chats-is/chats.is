import { createFileRoute } from '@tanstack/react-router';

import { LibraryView } from '@/components/library-view';

export const Route = createFileRoute('/_chat/library')({
  head: () => ({ meta: [{ title: 'Library' }] }),
  component: LibraryView
});
