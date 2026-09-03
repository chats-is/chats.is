import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { quotaQueries } from '@/server/fn/quota';
import { RoutePending } from '@/components/route-pending';
import { QuotaSettings } from '@/components/console/settings/quota';

export const Route = createFileRoute('/console/settings/quota')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(quotaQueries.listForSelect()),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Quota Settings') }] }),
  pendingComponent: RoutePending,
  component: QuotaSettings
});
