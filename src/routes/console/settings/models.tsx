import { createFileRoute } from '@tanstack/react-router';

import { modelQueries } from '@/server/fn/model';
import { RoutePending } from '@/components/route-pending';
import { ModelsSettings } from '@/components/console/settings/models';

export const Route = createFileRoute('/console/settings/models')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(modelQueries.list({})),
  head: () => ({ meta: [{ title: 'Models Settings' }] }),
  pendingComponent: RoutePending,
  component: ModelsSettings
});
