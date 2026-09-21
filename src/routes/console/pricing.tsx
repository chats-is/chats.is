import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { pageSearchSchema } from '@/types/pagination';
import { pageTitle } from '@/lib/head';
import { loadForVisit } from '@/lib/route-loader';
import { pricingQueries } from '@/server/functions/pricing';
import Pricing, { PricingPending } from '@/components/console/pricing';
import { pricingTableInput } from '@/components/console/table-filters';

/** Filters live in the address, so a filtered view can be linked, refreshed
 *  and come back to. Each is optional: a filter at its default is simply
 *  absent, which keeps an unfiltered page's URL clean. */
const searchSchema = z.object({
  capability: z.string().optional(),
  q: z.string().optional(),
  page: pageSearchSchema
});

export const Route = createFileRoute('/console/pricing')({
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
   */
  // The table on screen is a function of the address, so the loader is too:
  // it asks for the page and filter the component is about to read, not for
  // the first page of everything.
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps, cause }) =>
    loadForVisit(
      context.queryClient,
      pricingQueries.listWithModels(pricingTableInput(deps)),
      cause
    ),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Pricing') }] }),
  pendingComponent: PricingPending,
  component: Pricing
});
