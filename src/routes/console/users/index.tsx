import { createFileRoute } from '@tanstack/react-router';

import { quotaQueries } from '@/server/fn/quota';
import { userQueries } from '@/server/fn/user';
import Users from '@/components/console/users';

export const Route = createFileRoute('/console/users/')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(userQueries.list({})),
      context.queryClient.ensureQueryData(userQueries.stats()),
      context.queryClient.ensureQueryData(quotaQueries.listForSelect())
    ]),
  head: () => ({ meta: [{ title: 'Users' }] }),
  component: Users
});
