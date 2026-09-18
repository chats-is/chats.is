import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { pageSearchSchema } from '@/types/pagination';
import { pageTitle } from '@/lib/head';
import { providerQueries } from '@/server/functions/provider';
import Providers from '@/components/console/providers';
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
      providerQueries.list(providerTableInput({}))
    );
  },
  head: ({ matches }) => ({
    meta: [{ title: pageTitle(matches, 'Providers') }]
  }),
  component: Providers
});
