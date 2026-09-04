import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { modelQueries } from '@/server/fn/model';
import { ModelsSettings } from '@/components/console/settings/models';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';

export const Route = createFileRoute('/console/settings/models')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(modelQueries.list({})),
  head: ({ matches }) => ({
    meta: [{ title: pageTitle(matches, 'Models Settings') }]
  }),
  pendingComponent: () => <ConsoleTableSkeleton columns={3} toolbar={false} />,
  component: ModelsSettings
});
