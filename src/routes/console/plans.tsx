import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { pageSearchSchema } from '@/types/pagination';
import { pageTitle } from '@/lib/head';
import { planQueries } from '@/server/functions/plan';
import { quotaQueries } from '@/server/functions/quota';
import Plans, { PlansPending } from '@/components/console/plans';
import { planTableInput } from '@/components/console/table-filters';

/** The page lives in the address, so a page of the table can be linked,
 *  refreshed and come back to. The first page is spelled by leaving it out. */
const searchSchema = z.object({ page: pageSearchSchema });

export const Route = createFileRoute('/console/plans')({
  validateSearch: searchSchema,
  /**
   * The unfiltered first page, awaited — and deliberately not a function of the
   * address. Were the page and the filters read here, every page turn and every
   * keystroke would re-run this loader and stand the placeholder in front of a
   * table that is already on screen. They belong to the table's own query,
   * which keeps the previous page visible while the next one loads.
   *
   * The key is the one the component asks for on a plain visit, so it mounts
   * with data rather than skeletoning a second time.
   *
   * The selects beside it are started alongside but not waited for: they fill
   * dropdowns inside a dialog, and nothing on the page behind it is waiting to
   * know them.
   */
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(quotaQueries.listForSelect());
    return context.queryClient.ensureQueryData(
      planQueries.list(planTableInput({}))
    );
  },
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Plans') }] }),
  pendingComponent: PlansPending,
  component: Plans
});
