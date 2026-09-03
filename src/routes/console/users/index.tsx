import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { quotaQueries } from '@/server/fn/quota';
import { userQueries } from '@/server/fn/user';
import { RoutePending } from '@/components/route-pending';
import Users from '@/components/console/users';

export const Route = createFileRoute('/console/users/')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(userQueries.list({})),
      context.queryClient.ensureQueryData(userQueries.stats()),
      context.queryClient.ensureQueryData(quotaQueries.listForSelect())
    ]),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Users') }] }),
  pendingComponent: RoutePending,
  component: Users
});
