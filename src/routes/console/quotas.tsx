import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { pageSearchSchema } from '@/types/pagination';
import { pageTitle } from '@/lib/head';
import { quotaQueries } from '@/server/functions/quota';
import Quotas, { QuotasPending } from '@/components/console/quotas';
import { quotaTableInput } from '@/components/console/table-filters';

/** The page lives in the address, so a page of the table can be linked,
 *  refreshed and come back to. The first page is spelled by leaving it out. */
const searchSchema = z.object({ page: pageSearchSchema });

export const Route = createFileRoute('/console/quotas')({
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
    return context.queryClient.ensureQueryData(
      quotaQueries.list(quotaTableInput({}))
    );
  },
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Quotas') }] }),
  pendingComponent: QuotasPending,
  component: Quotas
});
