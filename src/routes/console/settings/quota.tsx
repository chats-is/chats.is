import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { quotaQueries } from '@/server/functions/quota';
import { QuotaSettings } from '@/components/console/settings/quota';
import { ConsoleSettingsPanelSkeleton } from '@/components/console/skeletons';

export const Route = createFileRoute('/console/settings/quota')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(quotaQueries.listForSelect()),
  head: ({ matches }) => ({
    meta: [{ title: pageTitle(matches, 'Quota Settings') }]
  }),
  pendingComponent: ConsoleSettingsPanelSkeleton,
  component: QuotaSettings
});
