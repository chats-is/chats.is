import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { pageSearchSchema } from '@/types/pagination';
import { pageTitle } from '@/lib/head';
import { planQueries } from '@/server/functions/plan';
import { quotaQueries } from '@/server/functions/quota';
import Plans from '@/components/console/plans';
import { planTableInput } from '@/components/console/table-filters';

/** The page lives in the address, so a page of the table can be linked,
 *  refreshed and come back to. The first page is spelled by leaving it out. */
const searchSchema = z.object({ page: pageSearchSchema });

export const Route = createFileRoute('/console/plans')({
  validateSearch: searchSchema,
  /**
   * Starts the page's queries without waiting for them.
   *
   * An awaited loader makes the route pend, and a pending route shows a
   * placeholder for the whole page — the console layout's, if this route
   * declares none. That is the wrong shape for a table whose chrome (heading,
   * search box, pager) is ready immediately and whose rows are the only thing
   * still coming: the table stands in for its own rows, in its own outline.
   *
   * So these are fired and not awaited. The request still leaves before the
   * component mounts; the component simply renders its skeleton rows rather
   * than the route withholding the page until the rows exist.
   */
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(
      planQueries.list(planTableInput({}))
    );
    void context.queryClient.prefetchQuery(quotaQueries.listForSelect());
  },
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Plans') }] }),
  component: Plans
});
