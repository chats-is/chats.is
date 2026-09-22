import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { pageSearchSchema } from '@/types/pagination';
import { pageTitle } from '@/lib/head';
import { modelQueries } from '@/server/functions/model';
import { providerQueries } from '@/server/functions/provider';
import Models, { ModelsPending } from '@/components/console/models';
import { modelTableInput } from '@/components/console/table-filters';

/** Filters live in the address, so a filtered view can be linked, refreshed
 *  and come back to. Each is optional: a filter at its default is simply
 *  absent, which keeps an unfiltered page's URL clean. */
const searchSchema = z.object({
  capability: z.string().optional(),
  q: z.string().optional(),
  page: pageSearchSchema
});

export const Route = createFileRoute('/console/models')({
  validateSearch: searchSchema,
  /**
   * The unfiltered first page, awaited — and deliberately not a function of the
   * address. Were the page, the search term and the capability read here, every
   * page turn and every keystroke would re-run this loader and stand the
   * placeholder in front of a table that is already on screen. They belong to
   * the table's own query, which keeps the previous page visible while the next
   * one loads.
   *
   * The key is the one the component asks for on a plain visit, so it mounts
   * with data rather than skeletoning a second time.
   *
   * The provider list is started alongside but not waited for: it fills a
   * select inside the Add Model dialog, and nothing on the page behind that
   * dialog is waiting to know it.
   */
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(providerQueries.forSelect());
    return context.queryClient.ensureQueryData(
      modelQueries.list(modelTableInput({}))
    );
  },
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Models') }] }),
  pendingComponent: ModelsPending,
  component: Models
});
