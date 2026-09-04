import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { modelQueries } from '@/server/fn/model';
import { quotaQueries } from '@/server/fn/quota';
import Quotas from '@/components/console/quotas';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';

export const Route = createFileRoute('/console/quotas')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(quotaQueries.list()),
      context.queryClient.ensureQueryData(modelQueries.list({}))
    ]),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Quotas') }] }),
  pendingComponent: () => <ConsoleTableSkeleton columns={5} />,
  component: Quotas
});
