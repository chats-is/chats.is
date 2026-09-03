import { createFileRoute } from '@tanstack/react-router';

import { quotaQueries } from '@/server/fn/quota';
import { RoutePending } from '@/components/route-pending';
import { SettingsUsage } from '@/components/settings-usage';

export const Route = createFileRoute('/_chat/settings/usage')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(quotaQueries.me()),
  head: () => ({ meta: [{ title: 'Usage' }] }),
  pendingComponent: RoutePending,
  component: SettingsUsage
});
