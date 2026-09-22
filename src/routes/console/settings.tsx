import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { modelQueries } from '@/server/functions/model';
import { quotaQueries } from '@/server/functions/quota';
import { settingsQueries } from '@/server/functions/settings';
import { ConsoleSettings } from '@/components/console/settings';

export const Route = createFileRoute('/console/settings')({
  /**
   * The values and the lists the rows read from. A first visit waits for all
   * three, so the page is drawn once, with its values; after that it is drawn
   * from what is held, and the form reads the values again behind it and
   * holds itself until they land — the console's settings are edited as a
   * whole, and a form saved on last visit's values writes those back over
   * whatever changed since.
   */
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(settingsQueries.list()),
      context.queryClient.ensureQueryData(modelQueries.forSelect()),
      context.queryClient.ensureQueryData(quotaQueries.listForSelect())
    ]),
  head: ({ matches }) => ({
    meta: [{ title: pageTitle(matches, 'Settings') }]
  }),
  component: ConsoleSettings
});
