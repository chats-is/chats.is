import { createFileRoute } from '@tanstack/react-router';

import { planQueries } from '@/server/fn/plan';
import { quotaQueries } from '@/server/fn/quota';
import Plans from '@/components/console/plans';

export const Route = createFileRoute('/console/plans')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(planQueries.list()),
      context.queryClient.ensureQueryData(quotaQueries.listForSelect())
    ]),
  head: () => ({ meta: [{ title: 'Plans' }] }),
  component: Plans
});
