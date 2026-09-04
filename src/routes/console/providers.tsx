import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { providerQueries } from '@/server/fn/provider';
import Providers from '@/components/console/providers';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';

export const Route = createFileRoute('/console/providers')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(providerQueries.list()),
  head: ({ matches }) => ({
    meta: [{ title: pageTitle(matches, 'Providers') }]
  }),
  pendingComponent: () => <ConsoleTableSkeleton columns={6} />,
  component: Providers
});
