import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { pageSearchSchema } from '@/types/pagination';
import { pageTitle } from '@/lib/head';
import { modelQueries } from '@/server/functions/model';
import { promptQueries } from '@/server/functions/prompt';
import Prompts from '@/components/console/prompts';
import { promptTableInput } from '@/components/console/table-filters';

/** Filters live in the address, so a filtered view can be linked, refreshed
 *  and come back to. Each is optional: a filter at its default is simply
 *  absent, which keeps an unfiltered page's URL clean. */
const searchSchema = z.object({
  q: z.string().optional(),
  page: pageSearchSchema
});

export const Route = createFileRoute('/console/prompts')({
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
      promptQueries.adminList(promptTableInput({}))
    );
    void context.queryClient.prefetchQuery(modelQueries.forSelect());
  },
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Prompts') }] }),
  component: Prompts
});
