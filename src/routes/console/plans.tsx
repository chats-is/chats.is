import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { planQueries } from '@/server/fn/plan';
import { quotaQueries } from '@/server/fn/quota';
import Plans from '@/components/console/plans';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';

export const Route = createFileRoute('/console/plans')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(planQueries.list()),
      context.queryClient.ensureQueryData(quotaQueries.listForSelect())
    ]),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Plans') }] }),
  pendingComponent: () => <ConsoleTableSkeleton columns={4} />,
  component: Plans
});
