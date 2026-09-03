import { createFileRoute } from '@tanstack/react-router';

import { modelQueries } from '@/server/fn/model';
import { quotaQueries } from '@/server/fn/quota';
import { RoutePending } from '@/components/route-pending';
import Quotas from '@/components/console/quotas';

export const Route = createFileRoute('/console/quotas')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(quotaQueries.list()),
      context.queryClient.ensureQueryData(modelQueries.list({}))
    ]),
  head: () => ({ meta: [{ title: 'Quotas' }] }),
  pendingComponent: RoutePending,
  component: Quotas
});
