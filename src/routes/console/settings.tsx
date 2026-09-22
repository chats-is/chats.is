import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { loadForVisit } from '@/lib/route-loader';
import { modelQueries } from '@/server/functions/model';
import { quotaQueries } from '@/server/functions/quota';
import { settingsQueries } from '@/server/functions/settings';
import { ConsoleSettings } from '@/components/console/settings';

export const Route = createFileRoute('/console/settings')({
  /**
   * The values and the lists the rows read from. A first visit waits for all
   * three, so the page is drawn once, with its values; after that it is drawn
   * from what is held and the values are read again behind it, with the form
   * held until they land — the console's settings are edited as a whole, and
   * a form saved on last visit's values writes those back over whatever
   * changed since. The values are read again on every visit, however recent
   * the last; the lists, only when stale.
   */
  loader: ({ context, cause }) =>
    Promise.all([
      loadForVisit(
        context.queryClient,
        { ...settingsQueries.list(), staleTime: 0 },
        cause
      ),
      loadForVisit(context.queryClient, modelQueries.forSelect(), cause),
      loadForVisit(context.queryClient, quotaQueries.listForSelect(), cause)
    ]),
  head: ({ matches }) => ({
    meta: [{ title: pageTitle(matches, 'Settings') }]
  }),
  component: ConsoleSettings
});
