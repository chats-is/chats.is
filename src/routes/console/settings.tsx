import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { WAIT_FOR_FRESH } from '@/lib/route-loader';
import { modelQueries } from '@/server/functions/model';
import { quotaQueries } from '@/server/functions/quota';
import { settingsQueries } from '@/server/functions/settings';
import {
  ConsoleSettings,
  SettingsPending
} from '@/components/console/settings';

export const Route = createFileRoute('/console/settings')({
  /**
   * The values and the lists the rows read from, all awaited. A row says
   * whether the model it names is still available, which is the wrong thing to
   * answer from a list that has not arrived — and a select with nothing in it
   * disables itself, which is the right answer for an installation with no
   * models and the wrong one for models still on their way.
   */
  loader: {
    ...WAIT_FOR_FRESH,
    handler: ({ context }) =>
      Promise.all([
        context.queryClient.fetchQuery(settingsQueries.list()),
        context.queryClient.fetchQuery(modelQueries.forSelect()),
        context.queryClient.fetchQuery(quotaQueries.listForSelect())
      ])
  },
  head: ({ matches }) => ({
    meta: [{ title: pageTitle(matches, 'Settings') }]
  }),
  pendingComponent: SettingsPending,
  component: ConsoleSettings
});
