import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { modelQueries } from '@/server/functions/model';
import { quotaQueries } from '@/server/functions/quota';
import { DefaultsSettings } from '@/components/console/settings/defaults';
import { ConsoleSettingsPanelSkeleton } from '@/components/console/skeletons';

export const Route = createFileRoute('/console/settings/defaults')({
  /**
   * The lists the rows read from, awaited. A row says whether the model it
   * names is still available, which is the wrong thing to answer from a list
   * that has not arrived — and a select with nothing in it disables itself,
   * which is the right answer for an installation with no models and the
   * wrong one for models still on their way.
   */
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(modelQueries.forSelect()),
      context.queryClient.ensureQueryData(quotaQueries.listForSelect())
    ]),
  head: ({ matches }) => ({
    meta: [{ title: pageTitle(matches, 'Default Settings') }]
  }),
  pendingComponent: ConsoleSettingsPanelSkeleton,
  component: DefaultsSettings
});
