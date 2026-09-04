import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { quotaQueries } from '@/server/fn/quota';
import { userQueries } from '@/server/fn/user';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';
import Users from '@/components/console/users';

export const Route = createFileRoute('/console/users/')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(userQueries.list({})),
      context.queryClient.ensureQueryData(userQueries.stats()),
      context.queryClient.ensureQueryData(quotaQueries.listForSelect())
    ]),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Users') }] }),
  pendingComponent: () => <ConsoleTableSkeleton columns={8} />,
  component: Users
});
