import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { pageSearchSchema } from '@/types/pagination';
import { pageTitle } from '@/lib/head';
import { modelQueries } from '@/server/functions/model';
import { tierQueries } from '@/server/functions/tier';
import { tierTableInput } from '@/components/console/table-filters';
import Tiers, { TiersPending } from '@/components/console/tiers';

/** The page lives in the address, so a page of the table can be linked,
 *  refreshed and come back to. The first page is spelled by leaving it out. */
const searchSchema = z.object({ page: pageSearchSchema });

export const Route = createFileRoute('/console/tiers')({
  validateSearch: searchSchema,
  /** The unfiltered first page, awaited, under the key the component asks
   *  for on a plain visit — see the plans route for why not the address. */
  loader: ({ context }) => {
    // The models fill the picker inside the dialog; nothing waits for them.
    void context.queryClient.prefetchQuery(modelQueries.forSelect());
    return context.queryClient.ensureQueryData(
      tierQueries.list(tierTableInput({}))
    );
  },
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Tiers') }] }),
  pendingComponent: TiersPending,
  component: Tiers
});
