import { createFileRoute } from '@tanstack/react-router';

import { quotaQueries } from '@/server/fn/quota';
import { RoutePending } from '@/components/route-pending';
import { QuotaSettings } from '@/components/console/settings/quota';

export const Route = createFileRoute('/console/settings/quota')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(quotaQueries.listForSelect()),
  head: () => ({ meta: [{ title: 'Quota Settings' }] }),
  pendingComponent: RoutePending,
  component: QuotaSettings
});
