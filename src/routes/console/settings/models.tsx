import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { modelQueries } from '@/server/functions/model';
import { ModelsSettings } from '@/components/console/settings/models';
import { ConsoleSettingsPanelSkeleton } from '@/components/console/skeletons';

export const Route = createFileRoute('/console/settings/models')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(modelQueries.forSelect()),
  head: ({ matches }) => ({
    meta: [{ title: pageTitle(matches, 'Models Settings') }]
  }),
  pendingComponent: ConsoleSettingsPanelSkeleton,
  component: ModelsSettings
});
