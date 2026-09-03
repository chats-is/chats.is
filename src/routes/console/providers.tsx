import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { providerQueries } from '@/server/fn/provider';
import { RoutePending } from '@/components/route-pending';
import Providers from '@/components/console/providers';

export const Route = createFileRoute('/console/providers')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(providerQueries.list()),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Providers') }] }),
  pendingComponent: RoutePending,
  component: Providers
});
