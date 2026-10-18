import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { settingsQueries } from '@/server/functions/settings';
import { ConsolePages } from '@/components/console/pages';

export const Route = createFileRoute('/console/pages')({
  // The pages are settings rows, read with the rest of them; the form holds
  // itself while they are read again, as the Settings page does.
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(settingsQueries.list()),
  head: ({ matches }) => ({
    meta: [{ title: pageTitle(matches, 'Pages') }]
  }),
  component: ConsolePages
});
