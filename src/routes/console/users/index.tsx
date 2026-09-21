import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { pageSearchSchema } from '@/types/pagination';
import { pageTitle } from '@/lib/head';
import { loadForVisit } from '@/lib/route-loader';
import { quotaQueries } from '@/server/functions/quota';
import { userQueries } from '@/server/functions/user';
import { userTableInput } from '@/components/console/table-filters';
import Users, { UsersPending } from '@/components/console/users';

/** Filters live in the address, so a filtered view can be linked, refreshed
 *  and come back to. Each is optional: a filter at its default is simply
 *  absent, which keeps an unfiltered page's URL clean. */
const searchSchema = z.object({
  q: z.string().optional(),
  page: pageSearchSchema
});

export const Route = createFileRoute('/console/users/')({
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
   * The counts in the toolbar and the quota options are started alongside but
   * not waited for: the toolbar stands in for the counts, and the options fill
   * a select inside a row that does not exist yet.
   */
  // The table on screen is a function of the address, so the loader is too:
  // it asks for the page and filter the component is about to read, not for
  // the first page of everything.
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps, cause }) => {
    void context.queryClient.prefetchQuery(userQueries.stats());
    void context.queryClient.prefetchQuery(quotaQueries.listForSelect());
    return loadForVisit(
      context.queryClient,
      userQueries.list(userTableInput(deps)),
      cause
    );
  },
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Users') }] }),
  pendingComponent: UsersPending,
  component: Users
});
