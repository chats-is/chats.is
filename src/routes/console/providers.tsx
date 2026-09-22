import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { pageSearchSchema } from '@/types/pagination';
import { pageTitle } from '@/lib/head';
import { providerQueries } from '@/server/functions/provider';
import Providers, { ProvidersPending } from '@/components/console/providers';
import { providerTableInput } from '@/components/console/table-filters';

/** Filters live in the address, so a filtered view can be linked, refreshed
 *  and come back to. Each is optional: a filter at its default is simply
 *  absent, which keeps an unfiltered page's URL clean. */
const searchSchema = z.object({
  q: z.string().optional(),
  page: pageSearchSchema
});

export const Route = createFileRoute('/console/providers')({
  validateSearch: searchSchema,
  /**
   * The unfiltered first page, awaited — and deliberately not a function of the
   * address. Were the page and the search term read here, every page turn and
   * every keystroke would re-run this loader and stand the placeholder in front
   * of a table that is already on screen. They belong to the table's own query,
   * which keeps the previous page visible while the next one loads.
   *
   * The key is the one the component asks for on a plain visit, so it mounts
   * with data rather than skeletoning a second time.
   */
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(
      providerQueries.list(providerTableInput({}))
    ),
  head: ({ matches }) => ({
    meta: [{ title: pageTitle(matches, 'Providers') }]
  }),
  pendingComponent: ProvidersPending,
  component: Providers
});
