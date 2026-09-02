import { createFileRoute } from '@tanstack/react-router';

import { quotaQueries } from '@/server/fn/quota';
import { SettingsUsage } from '@/components/settings-usage';

export const Route = createFileRoute('/_chat/settings/usage')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(quotaQueries.me()),
  head: () => ({ meta: [{ title: 'Usage' }] }),
  component: SettingsUsage
});
