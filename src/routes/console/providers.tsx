import { createFileRoute } from '@tanstack/react-router';

import { providerQueries } from '@/server/fn/provider';
import { RoutePending } from '@/components/route-pending';
import Providers from '@/components/console/providers';

export const Route = createFileRoute('/console/providers')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(providerQueries.list()),
  head: () => ({ meta: [{ title: 'Providers' }] }),
  pendingComponent: RoutePending,
  component: Providers
});
