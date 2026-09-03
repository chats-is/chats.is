import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { quotaQueries } from '@/server/fn/quota';
import { RoutePending } from '@/components/route-pending';
import { SettingsUsage } from '@/components/settings-usage';

export const Route = createFileRoute('/_chat/settings/usage')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(quotaQueries.me()),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Usage') }] }),
  pendingComponent: RoutePending,
  component: SettingsUsage
});
